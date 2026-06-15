import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  s3Config,
  DO_BUCKET,
  deleteFromS3FileUrl,
  isOwnBucketUrl,
} from "../../middlewares/upload";
import { PdfUploadJob } from "../../models/system/PdfUploadJob.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { setEbookUploadStatus } from "../ebook/ebook.service";
import logger from "../../utils/logger";
import {
  emitPdfJobUpdate,
  emitPdfBatchDone,
  PdfJobUpdate,
} from "../../socket/pdf-progress.socket";

// BullMQ queue that uploads admin-supplied PDFs to DigitalOcean Spaces and
// attaches each to its ebook's `bookUrl` — strictly one PDF at a time so none
// is skipped and the admin sees a clean queued → in_progress → completed march
// through the batch. Modeled on admin/notification/scheduler.ts (dedicated
// Redis connections, boot rehydrate, graceful shutdown).

const QUEUE_NAME = "pdf-upload";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

interface PdfUploadJobData {
  // PdfUploadJob._id — also used as the BullMQ jobId so enqueue is idempotent
  // and a reconnecting admin can correlate socket events to DB rows.
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

export function getPdfUploadQueue(): Queue<PdfUploadJobData> {
  if (!queue)
    throw new Error(
      "PDF upload scheduler not initialised. Call initPdfUploadScheduler() first."
    );
  return queue;
}

// The health endpoint reads these without throwing — a null queue/worker just
// means the scheduler hasn't booted yet, which the report surfaces as such.
export function getPdfUploadQueueOrNull(): Queue<PdfUploadJobData> | null {
  return queue;
}

export function getPdfUploadWorkerOrNull(): Worker<PdfUploadJobData> | null {
  return worker;
}

/**
 * Enqueue one PDF job. jobId = the PdfUploadJob._id so a duplicate enqueue
 * (e.g. boot rehydrate after the controller already added it) is a no-op.
 * Jobs run FIFO at concurrency 1, so the batch processes in insertion order.
 */
export async function enqueuePdfUploadJob(jobRecordId: string): Promise<void> {
  if (!queue) throw new Error("PDF upload scheduler not initialised.");
  await queue.add(
    "upload",
    { jobRecordId },
    {
      jobId: jobRecordId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    }
  );
}

// Build the socket payload from a job row.
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

// After a job reaches a terminal state, check whether its batch is fully done
// and, if so, emit the batch summary.
async function maybeEmitBatchDone(batchId: string): Promise<void> {
  const [total, completed, failed] = await Promise.all([
    PdfUploadJob.countDocuments({ batchId }),
    PdfUploadJob.countDocuments({ batchId, status: "completed" }),
    PdfUploadJob.countDocuments({ batchId, status: "failed" }),
  ]);
  if (completed + failed >= total) {
    emitPdfBatchDone({ batchId, total, completed, failed });
  }
}

/**
 * The per-PDF work: mark in_progress → stream the staged temp file to Spaces →
 * write the public URL onto the ebook's bookUrl → mark completed. Progress is
 * pushed to BullMQ AND mirrored to the DB + admin socket at each step.
 */
async function processPdf(job: Job<PdfUploadJobData>): Promise<void> {
  const { jobRecordId } = job.data;
  const row: any = await PdfUploadJob.findById(jobRecordId);
  if (!row) {
    logger.warn("PDF upload: job row missing, dropping", { jobRecordId });
    return; // nothing to do — row was deleted
  }
  if (row.status === "completed") return; // idempotent re-run guard

  const target: "bookUrl" | "demoUrl" =
    row.targetField === "demoUrl" ? "demoUrl" : "bookUrl";

  // Mirror each transition to: the job row, BullMQ, the admin socket, AND the
  // ebook document (so the list/detail reflect status across sessions + refresh).
  // Job "in_progress" maps to the ebook's canonical "processing" value; "queued"
  // and "completed" map 1:1. `set` carries the resolved url/filename on the
  // completed write so the doc never shows completed without its bookUrl/demoUrl.
  const setProgress = async (
    progress: number,
    status = row.status,
    set?: Record<string, unknown>
  ) => {
    row.status = status;
    row.progress = progress;
    await row.save();
    await job.updateProgress(progress);
    emitPdfJobUpdate(toUpdate(row));

    const ebookStatus = status === "in_progress" ? "processing" : status;
    await setEbookUploadStatus(String(row.ebookId), target, {
      status: ebookStatus,
      progress,
      set,
    }).catch((err) =>
      // Persisting status must not fail the upload — the socket already carried
      // the live value; the DB mirror is best-effort.
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

  // Stream the staged file up to Spaces. We don't hold it in memory — large
  // book PDFs would blow the heap.
  const key = `admin/ebooks/${Date.now()}-${path.basename(row.fileName)}`;
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

  const endpoint = (
    process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com"
  ).replace(/\/+$/, "");
  const { protocol, host } = new URL(endpoint);
  const fileUrl = `${protocol}//${DO_BUCKET}.${host}/${key}`;

  // Attach to the ebook on the requested field (bookUrl or demoUrl) plus its
  // matching *FileName field. Read the OLD url first so we can delete the
  // replaced file from Spaces afterwards (an update overwrites the slot, and
  // without this the previous PDF is orphaned in storage forever). If the
  // ebook vanished, fail the job so it's visible rather than silently dropping
  // the upload.
  const nameField = target === "demoUrl" ? "demoFileName" : "bookFileName";
  const ebook: any = await Ebook.findById(row.ebookId).select(target).lean();
  if (!ebook) {
    throw new Error(`Ebook ${row.ebookId} not found — cannot attach PDF.`);
  }
  const oldUrl: string | null = ebook[target] || null;

  // The completed write sets status="completed" + the url/filename in one update
  // (via setProgress's `set`), so the ebook never reads completed without its
  // bookUrl/demoUrl.
  row.fileUrl = fileUrl;
  row.finishedAt = new Date();
  await setProgress(100, "completed", {
    [target]: fileUrl,
    [nameField]: row.fileName,
  });

  // Best-effort cleanup of the staged temp file.
  await fs.unlink(row.tempPath).catch(() => {});

  // Delete the PDF this upload replaced from Spaces — only AFTER the new one is
  // attached, only if it actually changed, and only if it lives in OUR bucket
  // (deleteFromS3FileUrl keys off the URL path against DO_BUCKET, so a foreign
  // URL — e.g. an externally-hosted link — must not be passed to it). A
  // re-upload of the same URL or an empty slot has nothing to remove.
  // Best-effort: deleteFromS3FileUrl swallows its own errors, so a storage blip
  // can't fail the job.
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
 * Boot rehydrate — any job left in queued/in_progress (e.g. the pod died
 * mid-batch) is re-enqueued so the march resumes. in_progress is reset to
 * queued first; the deterministic jobId keeps this idempotent.
 */
async function rehydratePendingJobs(): Promise<number> {
  const rows = await PdfUploadJob.find({
    status: { $in: ["queued", "in_progress"] },
  })
    .select("_id status")
    .lean();

  let count = 0;
  for (const row of rows) {
    try {
      if (row.status === "in_progress") {
        await PdfUploadJob.updateOne(
          { _id: row._id },
          { $set: { status: "queued", progress: 0 } }
        );
      }
      await enqueuePdfUploadJob(String(row._id));
      count++;
    } catch (err) {
      logger.error("PDF upload rehydrate: failed to enqueue", {
        id: String(row._id),
        error: (err as Error).message,
      });
    }
  }
  return count;
}

export async function initPdfUploadScheduler(): Promise<void> {
  if (started) return;
  started = true;

  connection = buildConnection();
  queue = new Queue<PdfUploadJobData>(QUEUE_NAME, { connection });

  worker = new Worker<PdfUploadJobData>(
    QUEUE_NAME,
    async (job) => {
      await processPdf(job);
    },
    {
      connection: buildConnection(),
      // concurrency 1 → strict one-at-a-time, in-order processing. This is the
      // whole point: every PDF marches queued → in_progress → completed, one
      // after another, so none is skipped and the admin sees a clean sequence.
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
    // Only flip the row to "failed" once retries are exhausted — interim
    // attempts keep it visible as in_progress.
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        const row: any = await PdfUploadJob.findByIdAndUpdate(
          job.data.jobRecordId,
          { $set: { status: "failed", failureReason: err.message, finishedAt: new Date() } },
          { new: true }
        );
        if (row) {
          emitPdfJobUpdate(toUpdate(row));
          // Persist "failed" onto the ebook slot too (note: bookUrl/demoUrl is
          // left as-is — a failed re-upload keeps the previous file).
          const target: "bookUrl" | "demoUrl" =
            row.targetField === "demoUrl" ? "demoUrl" : "bookUrl";
          await setEbookUploadStatus(String(row.ebookId), target, {
            status: "failed",
          }).catch(() => {});
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

/** Graceful shutdown — close worker/events/queue + the dedicated connection. */
export async function shutdownPdfUploadScheduler(): Promise<void> {
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
