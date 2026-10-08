import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import Redis, { type Redis as RedisType } from "ioredis";
import logger from "../../utils/logger";
import type { RankSheetJobOutcome } from "./rank-predictor.types";

// Reading a response sheet is CPU-heavy on the OCR service, and an exam day
// brings a thousand students at once. Every upload is queued here and read by
// the worker process at a fixed concurrency, so the OCR service only ever sees
// as many sheets as it can read at a time: a spike becomes a short wait instead
// of 503s, timeouts and "please try again". A sheet that fails for a passing
// reason (OCR down, overloaded, timed out) is retried with backoff; a sheet that
// cannot be read is settled at once with its real reason.
// Modeled on admin/pdfUpload/pdfUpload.scheduler.ts.

/**
 * Set per deployment when staging and production share a Redis: a worker that
 * takes another deployment's job would look the sheet up in the wrong database.
 */
const QUEUE_NAME = process.env.RANK_SHEET_QUEUE || "rank-sheet";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

/** Sheets read at once by each worker process — match it to the OCR service's cores. */
const CONCURRENCY = Number(process.env.RANK_SHEET_CONCURRENCY) || 4;
/** A passing failure is retried this many times in all, backing off from 5s. */
const ATTEMPTS = Number(process.env.RANK_SHEET_ATTEMPTS) || 5;
const BACKOFF_MS = 5_000;

export interface RankSheetJobData {
  submissionId: string;
}

let queue: Queue<RankSheetJobData, RankSheetJobOutcome> | null = null;
let queueEvents: QueueEvents | null = null;
let worker: Worker<RankSheetJobData, RankSheetJobOutcome> | null = null;
let connection: RedisType | null = null;
let started = false;

// BullMQ needs dedicated connections with maxRetriesPerRequest: null.
const buildConnection = (): RedisType =>
  new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

// The API process (WORKER_ENABLED=false) enqueues and waits; it never reads.
const ensureProducer = (): Queue<RankSheetJobData, RankSheetJobOutcome> => {
  if (!queue) {
    connection = connection ?? buildConnection();
    queue = new Queue<RankSheetJobData, RankSheetJobOutcome>(QUEUE_NAME, { connection });
  }
  return queue;
};

const ensureEvents = (): QueueEvents => {
  queueEvents = queueEvents ?? new QueueEvents(QUEUE_NAME, { connection: buildConnection() });
  return queueEvents;
};

/** BullMQ refuses a purely numeric custom id, so the submission id is prefixed. */
const jobIdFor = (submissionId: bigint | string): string => `sheet-${submissionId}`;

/** Idempotent: the same submission is never queued twice. */
export const enqueueRankSheet = async (
  submissionId: bigint | string
): Promise<Job<RankSheetJobData, RankSheetJobOutcome>> =>
  ensureProducer().add(
    "read",
    { submissionId: String(submissionId) },
    {
      jobId: jobIdFor(submissionId),
      attempts: ATTEMPTS,
      backoff: { type: "exponential", delay: BACKOFF_MS },
      removeOnComplete: { count: 5000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    }
  );

/**
 * The outcome if the sheet is read within `waitMs`, else null — the student is
 * then told it is queued and the page picks the result up when it lands.
 */
export const waitForRankSheet = async (
  job: Job<RankSheetJobData, RankSheetJobOutcome>,
  waitMs: number
): Promise<RankSheetJobOutcome | null> => {
  try {
    return await job.waitUntilFinished(ensureEvents(), waitMs);
  } catch {
    // Still queued, or still retrying a passing failure: either way not settled yet.
    return null;
  }
};

/** Jobs waiting or being read now — for health checks and logs. */
export const rankSheetBacklog = async (): Promise<number> => {
  const counts = await ensureProducer().getJobCounts("waiting", "active", "delayed");
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
};

export const initRankSheetScheduler = async (handlers: {
  /** Reads and scores one sheet. Throws only for a failure worth retrying. */
  process: (submissionId: bigint) => Promise<RankSheetJobOutcome>;
  /** Retries are spent: settle the sheet as failed so the student can upload again. */
  giveUp: (submissionId: bigint, error: Error) => Promise<void>;
  /** Submissions left in "processing" by a crash or a deploy, to queue again. */
  pending: () => Promise<bigint[]>;
}): Promise<void> => {
  if (started) return;
  started = true;
  ensureProducer();

  worker = new Worker<RankSheetJobData, RankSheetJobOutcome>(
    QUEUE_NAME,
    async (job) => handlers.process(BigInt(job.data.submissionId)),
    { connection: buildConnection(), concurrency: CONCURRENCY }
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const spent = job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.warn("Rank sheet read failed", {
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      willRetry: !spent,
      error: error.message,
    });
    if (!spent) return;
    try {
      await handlers.giveUp(BigInt(job.data.submissionId), error);
    } catch (giveUpError) {
      logger.error("Rank sheet: could not settle a sheet after its retries", {
        jobId: job.id,
        error: (giveUpError as Error).message,
      });
    }
  });

  worker.on("error", (error) => logger.error("Rank sheet worker error", { error: error.message }));

  let requeued = 0;
  for (const submissionId of await handlers.pending()) {
    try {
      await enqueueRankSheet(submissionId);
      requeued++;
    } catch (error) {
      logger.error("Rank sheet: could not requeue", {
        submissionId: String(submissionId),
        error: (error as Error).message,
      });
    }
  }
  logger.info("BullMQ rank sheet scheduler started.", { concurrency: CONCURRENCY, requeued });
};

export const shutdownRankSheetScheduler = async (): Promise<void> => {
  try {
    await worker?.close();
    await queueEvents?.close();
    await queue?.close();
    await connection?.quit();
  } catch (error) {
    logger.error("Error shutting down rank sheet scheduler", { error: (error as Error).message });
  } finally {
    worker = null;
    queueEvents = null;
    queue = null;
    connection = null;
    started = false;
  }
};
