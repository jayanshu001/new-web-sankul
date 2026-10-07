// Ebook PDF upload: BullMQ worker that streams staged PDFs to Spaces and attaches them.
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  s3Config,
  DO_BUCKET,
  publicUrlFor,
  deleteFromS3FileUrl,
  isOwnBucketUrl,
} from "../../middlewares/upload";
import {
  getJobByIdSql,
  updateJobSql,
  batchCountsSql,
  rehydrateRowsSql,
  setEbookUploadStatusSql,
  getEbookUrlSql,
  ebookExistsSql,
} from "../../modules/pdf-upload/pdf-upload.service";
import logger from "../../utils/logger";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  emitPdfJobUpdate,
  emitPdfBatchDone,
  PdfJobUpdate,
} from "../../socket/pdf-progress.socket";

// Uploads admin PDFs to Spaces and attaches each to its ebook, strictly one at a
// time so none is skipped and progress reads queued → in_progress → completed.

const QUEUE_NAME = "pdf-upload";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

interface PdfUploadJobData {
  // Job row id; also the basis of the BullMQ jobId, so enqueue is idempotent and
  // a reconnecting admin can correlate socket events to rows.
  jobRecordId: string;
}

let queue: Queue<PdfUploadJobData> | null = null;
let worker: Worker<PdfUploadJobData> | null = null;
let queueEvents: QueueEvents | null = null;
let connection: RedisType | null = null;
let started = false;

// BullMQ needs a dedicated ioredis connection with maxRetriesPerRequest: null
// and enableReadyCheck: false — never the shared cache/session redisClient.
function buildConnection(): RedisType {
  return new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// In split PM2 deployments the API runs with WORKER_ENABLED=false but still
// enqueues, so the producer is created lazily and reused by the worker.
function ensureProducer(): Queue<PdfUploadJobData> {
  if (!queue) {
    connection = connection ?? buildConnection();
    queue = new Queue<PdfUploadJobData>(QUEUE_NAME, { connection });
  }
  return queue;
}

export function getPdfUploadQueue(): Queue<PdfUploadJobData> {
  return ensureProducer();
}

// For the health endpoint: null means the scheduler hasn't booted yet.
export function getPdfUploadQueueOrNull(): Queue<PdfUploadJobData> | null {
  return queue;
}

export function getPdfUploadWorkerOrNull(): Worker<PdfUploadJobData> | null {
  return worker;
}

/**
 * Deterministic jobId makes a duplicate enqueue (e.g. boot rehydrate) a no-op.
 * Concurrency 1 + FIFO keeps the batch in insertion order.
 */
export async function enqueuePdfUploadJob(jobRecordId: string): Promise<void> {
  const q = ensureProducer();
  await q.add(
    "upload",
    { jobRecordId },
    {
      // BullMQ rejects integer custom ids, so prefix the int row id (colon-free).
      // The worker resolves the row from job.data.jobRecordId, not job.id.
      jobId: `pdf-${jobRecordId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    }
  );
}

function toUpdate(row: any): PdfJobUpdate {
  return {
    batchId: row.batchId,
    jobId: String(row._id),
    index: row.index,
    fileName: row.fileName,
    ebookId: String(row.ebookId),
    status: row.status,
    progress: row.progress ?? 0,
    fileUrl: row.fileUrl ?? null,
    failureReason: row.failureReason ?? null,
  };
}

async function maybeEmitBatchDone(batchId: string): Promise<void> {
  const { total, completed, failed } = await batchCountsSql(batchId);
  if (completed + failed >= total) {
    emitPdfBatchDone({ batchId, total, completed, failed });
  }
}

async function processPdf(job: Job<PdfUploadJobData>): Promise<void> {
  const { jobRecordId } = job.data;
  const row: any = await getJobByIdSql(jobRecordId);
  if (!row) {
    logger.warn("PDF upload: job row missing, dropping", { jobRecordId });
    return;
  }
  if (row.status === "completed") return;

  const target: "bookUrl" | "demoUrl" =
    row.targetField === "demoUrl" ? "demoUrl" : "bookUrl";

  // Mirrors each transition to the job row, BullMQ, the socket and the ebook row.
  // Job "in_progress" maps to the ebook's "processing"; `set` carries url/filename
  // on the completed write so the ebook never reads completed without its url.
  const setProgress = async (
    progress: number,
    status = row.status,
    set?: Record<string, unknown>
  ) => {
    row.status = status;
    row.progress = progress;
    // The caller sets startedAt/fileUrl/finishedAt on row before calling.
    await updateJobSql(jobRecordId, {
      status,
      progress,
      startedAt: row.startedAt ?? undefined,
      finishedAt: row.finishedAt ?? undefined,
      fileUrl: row.fileUrl ?? undefined,
    });
    await job.updateProgress(progress);
    emitPdfJobUpdate(toUpdate(row));

    const ebookStatus = status === "in_progress" ? "processing" : status;
    const persistEbook = setEbookUploadStatusSql(String(row.ebookId), target, {
      status: ebookStatus,
      progress,
      set,
    });
    await persistEbook.catch((err) =>
      // Best-effort: must not fail the upload.
      logger.warn("PDF upload: failed to persist ebook status", {
        jobRecordId,
        ebookId: String(row.ebookId),
        status: ebookStatus,
        error: (err as Error).message,
      })
    );
  };

  row.startedAt = new Date();
  await setProgress(5, "in_progress");

  // Streamed, never buffered (heap). Key is ASCII-folded like presignUpload's
  // sanitizeName because the public URL is built by concatenation; the original
  // name is kept in book_file_name / demo_file_name for display.
  const safeName = path
    .basename(row.fileName)
    .replace(/[^\w.\-]+/g, "_")
    .slice(-120);
  const folder = target === "demoUrl" ? UPLOAD_FOLDERS.ebookDemo : UPLOAD_FOLDERS.ebookFull;
  const key = `${folder}/${Date.now()}-${safeName}`;
  const body = createReadStream(row.tempPath);
  await s3Config.send(
    new PutObjectCommand({
      Bucket: DO_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/pdf",
      ContentLength: row.fileSize,
      ACL: "public-read",
    })
  );
  await setProgress(80);

  const fileUrl = publicUrlFor(key);

  // Read the old url first so the replaced file can be deleted from Spaces
  // afterwards (otherwise it is orphaned). A vanished ebook fails the job loudly.
  const nameField = target === "demoUrl" ? "demoFileName" : "bookFileName";
  let oldUrl: string | null = null;
  // getEbookUrlSql returns null for both an empty slot and a missing row.
  if (!(await ebookExistsSql(String(row.ebookId)))) {
    throw new Error(`Ebook ${row.ebookId} not found — cannot attach PDF.`);
  }
  oldUrl = await getEbookUrlSql(String(row.ebookId), target);

  row.fileUrl = fileUrl;
  row.finishedAt = new Date();
  await setProgress(100, "completed", {
    [target]: fileUrl,
    [nameField]: row.fileName,
  });

  await fs.unlink(row.tempPath).catch(() => {});

  // Only after the new file is attached, only if changed, and only for our own
  // bucket (deleteFromS3FileUrl keys off the path, so a foreign URL must not
  // reach it). It swallows its own errors, so a storage blip can't fail the job.
  if (oldUrl && oldUrl !== fileUrl && isOwnBucketUrl(oldUrl)) {
    await deleteFromS3FileUrl(oldUrl);
    logger.info("PDF upload: removed replaced file from Spaces", {
      jobRecordId,
      ebookId: String(row.ebookId),
      field: target,
      oldUrl,
    });
  }

  await maybeEmitBatchDone(row.batchId);
}

/**
 * Re-enqueues jobs left queued/in_progress (e.g. the pod died mid-batch);
 * in_progress is reset to queued first. The deterministic jobId keeps it idempotent.
 */
async function rehydratePendingJobs(): Promise<number> {
  const ids = await rehydrateRowsSql();
  let count = 0;
  for (const id of ids) {
    try {
      await enqueuePdfUploadJob(id);
      count++;
    } catch (err) {
      logger.error("PDF upload rehydrate: failed to enqueue", {
        id,
        error: (err as Error).message,
      });
    }
  }
  return count;
}

export async function initPdfUploadScheduler(): Promise<void> {
  if (started) return;
  started = true;

  ensureProducer();

  worker = new Worker<PdfUploadJobData>(
    QUEUE_NAME,
    async (job) => {
      await processPdf(job);
    },
    {
      connection: buildConnection(),
      // Strict one-at-a-time, in-order processing is the point of this queue.
      concurrency: 1,
    }
  );

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: buildConnection() });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    logger.error("PDF upload job failed", {
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      error: err.message,
    });
    // Only once retries are exhausted; interim attempts stay in_progress.
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        const row: any = await updateJobSql(job.data.jobRecordId, {
          status: "failed",
          failureReason: err.message,
          finishedAt: new Date(),
        });
        if (row) {
          emitPdfJobUpdate(toUpdate(row));
          // bookUrl/demoUrl is left as-is: a failed re-upload keeps the previous file.
          const target: "bookUrl" | "demoUrl" =
            row.targetField === "demoUrl" ? "demoUrl" : "bookUrl";
          await setEbookUploadStatusSql(String(row.ebookId), target, { status: "failed" }).catch(() => {});
          await maybeEmitBatchDone(row.batchId);
        }
      } catch (updateErr) {
        logger.error("Failed to mark PDF job failed after retries", {
          jobId: job.id,
          error: (updateErr as Error).message,
        });
      }
    }
  });

  worker.on("completed", (job) => {
    logger.info("PDF upload job completed", { jobId: job.id });
  });

  worker.on("error", (err) => {
    logger.error("PDF upload worker error", { error: err.message });
  });

  const rehydrated = await rehydratePendingJobs();
  logger.info("BullMQ PDF upload scheduler started.", { rehydrated });
}

export
 async function shutdownPdfUploadScheduler(): Promise<void> {
  try {
    await worker?.close();
    await queueEvents?.close();
    await queue?.close();
    await connection?.quit();
  } catch (err) {
    logger.error("Error shutting down PDF upload scheduler", {
      error: (err as Error).message,
    });
  } finally {
    worker = null;
    queueEvents = null;
    queue = null;
    connection = null;
    started = false;
  }
}
