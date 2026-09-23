import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import {
  runExportJob,
  expireExportJob,
  rehydrateExportJobs,
  EXPORT_RETENTION_MS,
} from "../../modules/export-job/export-job.service";
import logger from "../../utils/logger";

// BullMQ queue that generates report exports (CSV/XLSX) off-request and uploads
// them to Spaces, then GC's the file after the retention window via a delayed job.
// Modeled on admin/pdfUpload/pdfUpload.scheduler.ts (dedicated Redis connections,
// boot rehydrate, graceful shutdown).

const QUEUE_NAME = "report-export";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// job.name discriminates the two kinds of work on this queue.
const GENERATE = "generate";
const EXPIRE = "expire";

interface ExportJobData {
  jobRef: string; // ExportJob.jobRef — also the BullMQ jobId (idempotent enqueue)
}

let queue: Queue<ExportJobData> | null = null;
let worker: Worker<ExportJobData> | null = null;
let queueEvents: QueueEvents | null = null;
let connection: RedisType | null = null;
let started = false;

// BullMQ needs a dedicated ioredis connection (maxRetriesPerRequest: null,
// enableReadyCheck: false) — never the shared cache/session redisClient.
function buildConnection(): RedisType {
  return new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, maxRetriesPerRequest: null, enableReadyCheck: false });
}

// Ensure a PRODUCER queue exists so jobs can be enqueued. This is deliberately
// independent of the worker: in a split deployment the HTTP process runs with
// WORKER_ENABLED=false (so initExportScheduler / the worker never run here), yet it
// still needs to enqueue from POST /admin/exports. It also covers the boot-race
// window where the HTTP server accepts a request before startWorkers() has finished.
// Idempotent — the worker's initExportScheduler reuses whatever this created.
function ensureProducer(): Queue<ExportJobData> {
  if (!queue) {
    connection = connection ?? buildConnection();
    queue = new Queue<ExportJobData>(QUEUE_NAME, { connection });
  }
  return queue;
}

/** Enqueue a generate job. jobId = `gen-<ref>` so a duplicate enqueue is a no-op. */
export async function enqueueExportJob(jobRef: string): Promise<void> {
  const q = ensureProducer();
  await q.add(
    GENERATE,
    { jobRef },
    {
      // BullMQ rejects purely-numeric custom jobIds; the ref is already prefixed.
      jobId: `gen-${jobRef}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    }
  );
}

/** Schedule the retention GC for a ready file (delayed delete of the object). */
async function scheduleExpiry(jobRef: string): Promise<void> {
  if (!queue) return;
  await queue.add(
    EXPIRE,
    { jobRef },
    { jobId: `exp-${jobRef}`, delay: EXPORT_RETENTION_MS, removeOnComplete: true, removeOnFail: { count: 1000 } }
  );
}

async function processExportJob(job: Job<ExportJobData>): Promise<void> {
  if (job.name === EXPIRE) {
    await expireExportJob(job.data.jobRef);
    return;
  }
  await runExportJob(job.data.jobRef);
  // Success → arm the retention GC.
  await scheduleExpiry(job.data.jobRef);
}

export async function initExportScheduler(): Promise<void> {
  if (started) return;
  started = true;

  // Reuse the producer queue if enqueue already lazily created it in this process.
  ensureProducer();

  worker = new Worker<ExportJobData>(QUEUE_NAME, processExportJob, {
    connection: buildConnection(),
    // A few reports can run in parallel; each holds its result buffer briefly.
    concurrency: 3,
  });

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: buildConnection() });

  worker.on("failed", (job, err) => {
    logger.error("Export job failed", { jobId: job?.id, attemptsMade: job?.attemptsMade, error: err.message });
  });
  worker.on("error", (err) => logger.error("Export worker error", { error: err.message }));

  // Boot rehydrate is best-effort: if ws_export_job isn't migrated yet (deploy
  // ordering), don't crash the app — new jobs will fail loudly at request time.
  try {
    const rehydrated = await rehydrateExportJobs();
    await Promise.all(rehydrated.map((ref) => enqueueExportJob(ref).catch(() => {})));
    logger.info("BullMQ report-export scheduler started.", { rehydrated: rehydrated.length });
  } catch (err) {
    logger.warn("report-export rehydrate skipped (table missing?).", { error: (err as Error).message });
  }
}

/** Graceful shutdown — close worker/events/queue + the dedicated connection. */
export async function shutdownExportScheduler(): Promise<void> {
  try {
    await worker?.close();
    await queueEvents?.close();
    await queue?.close();
    await connection?.quit();
  } catch (err) {
    logger.error("Error shutting down export scheduler", { error: (err as Error).message });
  } finally {
    worker = null;
    queueEvents = null;
    queue = null;
    connection = null;
    started = false;
  }
}
