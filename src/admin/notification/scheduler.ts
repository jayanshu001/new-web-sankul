// Admin notifications: BullMQ scheduler for delayed pushes (queue, worker, DLQ, rehydrate).
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import { dispatchScheduledById } from "./dispatcher";
import logger from "../../utils/logger";
import { queueDepth, queueDlqTotal } from "../../utils/metrics";
import {
  listScheduledForRehydrate as sqlListScheduledForRehydrate,
  existsSql as sqlNotificationExists,
  markFailed as sqlMarkFailed,
} from "../../modules/admin-notification/admin-notification.service";

const QUEUE_NAME = "notification-scheduler";
const DLQ_NAME = "notification-scheduler-dlq";
const QUEUE_DEPTH_SAMPLE_MS = 15_000;

// Refuse new schedules past this depth so a runaway loop or surge can't bloat the
// shared Redis. Soft ceiling: `bypassBackpressure` skips it (boot rehydrate).
const QUEUE_DEPTH_LIMIT = Number(process.env.NOTIFICATION_QUEUE_DEPTH_LIMIT) || 10_000;

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

interface NotificationJobData {
  notificationId: string;
}

/**
 * BullMQ rejects pure-integer custom job ids and ids containing a single colon,
 * so integer notification ids are prefixed with a hyphenated namespace. The job
 * payload keeps the raw id.
 */
const jobIdFor = (notificationId: string): string => `notif-${notificationId}`;

let queue: Queue<NotificationJobData> | null = null;
let dlq: Queue<NotificationJobData & { lastError: string }> | null = null;
let worker: Worker<NotificationJobData> | null = null;
let queueEvents: QueueEvents | null = null;
let connection: RedisType | null = null;
let depthInterval: NodeJS.Timeout | null = null;
let started = false;

/**
 * BullMQ requires a dedicated connection with `maxRetriesPerRequest: null` and
 * `enableReadyCheck: false`; do not reuse the shared redisClient (retries enabled).
 */
function buildConnection(): RedisType {
  return new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Lazily created producer: split PM2 deployments run the API with
// WORKER_ENABLED=false (initNotificationScheduler never runs there) yet still
// enqueue jobs. Also covers the boot race before startWorkers() finishes.
function ensureProducer(): Queue<NotificationJobData> {
  if (!queue) {
    connection = connection ?? buildConnection();
    queue = new Queue<NotificationJobData>(QUEUE_NAME, { connection });
  }
  return queue;
}

export function getNotificationQueue(): Queue<NotificationJobData> {
  return ensureProducer();
}

/** Controllers should map this to HTTP 503 with `Retry-After`. */
export class QueueBackpressureError extends Error {
  constructor(public readonly depth: number, public readonly limit: number) {
    super(`Notification queue is at ${depth}/${limit} — try again later.`);
    this.name = "QueueBackpressureError";
  }
}

export interface ScheduleOptions {
  /** Skip the queue-depth check (boot rehydrate, admin retries). */
  bypassBackpressure?: boolean;
}

/**
 * Job id derives from the notification id so it can be cancelled deterministically
 * and duplicate enqueues are no-ops. Throws QueueBackpressureError once waiting +
 * delayed reaches `QUEUE_DEPTH_LIMIT`.
 */
export async function scheduleNotificationJob(
  notificationId: string,
  scheduledAt: Date,
  options: ScheduleOptions = {}
): Promise<void> {
  const q = ensureProducer();
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

  if (!options.bypassBackpressure) {
    try {
      const counts = await q.getJobCounts("waiting", "delayed");
      const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
      if (depth >= QUEUE_DEPTH_LIMIT) {
        logger.warn("Notification queue depth exceeded; rejecting new schedule.", {
          notificationId,
          depth,
          limit: QUEUE_DEPTH_LIMIT,
        });
        throw new QueueBackpressureError(depth, QUEUE_DEPTH_LIMIT);
      }
    } catch (err) {
      // A Redis blip during the depth check must not block writes.
      if (err instanceof QueueBackpressureError) throw err;
    }
  }

  // Remove any stale job for the same id (reschedule); BullMQ throws if a job with
  // the same id exists in a different state.
  try {
    const existing = await q.getJob(jobIdFor(notificationId));
    if (existing) await existing.remove();
  } catch {
    // getJob can throw for a locked job; add() below surfaces any real error.
  }

  await q.add(
    "dispatch",
    { notificationId },
    {
      jobId: jobIdFor(notificationId),
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    }
  );
}

/** Safe to call if the job no longer exists. */
export async function cancelNotificationJob(notificationId: string): Promise<void> {
  const q = ensureProducer();
  const job = await q.getJob(jobIdFor(notificationId));
  if (job) {
    try {
      await job.remove();
    } catch (err) {
      logger.warn("Failed to remove notification job; it may have already fired.", {
        notificationId,
        error: (err as Error).message,
      });
    }
  }
}

const REHYDRATE_LOCK_KEY = "notif:rehydrate:boot-lock";
const REHYDRATE_LOCK_TTL_SEC = 120;

/**
 * Only one worker process scans scheduled rows on boot. Job ids are idempotent,
 * but the duplicated scan + enqueue loop is wasteful.
 */
async function tryAcquireRehydrateLock(conn: RedisType): Promise<boolean> {
  const acquired = await conn.set(
    REHYDRATE_LOCK_KEY,
    String(process.pid),
    "EX",
    REHYDRATE_LOCK_TTL_SEC,
    "NX"
  );
  return acquired === "OK";
}

/** Re-enqueues every "scheduled" notification on boot; idempotent via deterministic job ids. */
async function rehydrateScheduledNotifications(): Promise<number> {
  const recovery: { id: string; scheduledAt: Date }[] = [];

  try {
    recovery.push(...(await sqlListScheduledForRehydrate()));
  } catch (err) {
    logger.error("Rehydrate: failed to read SQL scheduled notifications", {
      error: (err as Error).message,
    });
  }

  let count = 0;
  for (const row of recovery) {
    try {
      // Recovery of existing work, not new load; refusing it would lose the row.
      await scheduleNotificationJob(row.id, row.scheduledAt, {
        bypassBackpressure: true,
      });
      count++;
    } catch (err) {
      logger.error("Rehydrate: failed to enqueue scheduled notification", {
        id: row.id,
        error: (err as Error).message,
      });
    }
  }
  return count;
}

// Start worker, DLQ and depth sampler; one process re-enqueues scheduled rows on boot.
export async function initNotificationScheduler(): Promise<void> {
  if (started) return;
  started = true;

  ensureProducer();
  // Jobs that exhaust retries are copied here with the last error. No worker:
  // it is a forensics inbox, drained or replayed by hand.
  dlq = new Queue<NotificationJobData & { lastError: string }>(DLQ_NAME, {
    connection: buildConnection(),
  });

  worker = new Worker<NotificationJobData>(
    QUEUE_NAME,
    async (job: Job<NotificationJobData>) => {
      const { notificationId } = job.data;
      const result = await dispatchScheduledById(notificationId);
      if (!result) {
        // Already claimed/cancelled.
        return { skipped: true };
      }
      if (result.status === "failed") {
        // Throw to trigger a retry; the dispatcher already rolled the row back to "scheduled".
        throw new Error(result.failureReason || "Dispatch failed.");
      }
      return {
        skipped: false,
        recipientCount: result.recipientCount,
        failureCount: result.failureCount,
      };
    },
    {
      connection: buildConnection(),
      concurrency: 5,
    }
  );

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: buildConnection() });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    logger.error("Notification job failed", {
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      error: err.message,
    });
    // Retries exhausted: mark the row failed and copy the job to the DLQ.
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        if (await sqlNotificationExists(job.data.notificationId)) {
          await sqlMarkFailed(job.data.notificationId, err.message);
        }
      } catch (updateErr) {
        logger.error("Failed to mark notification as failed after retries exhausted", {
          jobId: job.id,
          error: (updateErr as Error).message,
        });
      }
      try {
        if (dlq) {
          await dlq.add(
            "dead-letter",
            { notificationId: job.data.notificationId, lastError: err.message },
            {
              // Hyphen, not colon: BullMQ rejects single-colon custom ids.
              jobId: `dlq-${job.id}`,
              removeOnComplete: false,
              // Kept for manual inspection; retention capped at 30 days.
              removeOnFail: { age: 30 * 24 * 60 * 60 },
            }
          );
          queueDlqTotal.inc({ queue: QUEUE_NAME });
        }
      } catch (dlqErr) {
        logger.error("Failed to push notification job to DLQ", {
          jobId: job.id,
          error: (dlqErr as Error).message,
        });
      }
    }
  });

  worker.on("completed", (job) => {
    logger.info("Notification job completed", { jobId: job.id });
  });

  worker.on("error", (err) => {
    logger.error("Notification worker error", { error: err.message });
  });

  let rehydrated = 0;
  if (connection && (await tryAcquireRehydrateLock(connection))) {
    rehydrated = await rehydrateScheduledNotifications();
  } else {
    logger.info("Notification rehydrate skipped — another worker holds the boot lock.");
  }
  logger.info("BullMQ notification scheduler started.", { rehydrated });

  // Publish queue depth to /metrics.
  depthInterval = setInterval(async () => {
    try {
      if (!queue) return;
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed"
      );
      for (const state of ["waiting", "active", "delayed", "failed"] as const) {
        queueDepth.set(counts[state] ?? 0, { queue: QUEUE_NAME, state });
      }
      if (dlq) {
        const dlqCounts = await dlq.getJobCounts("waiting", "delayed");
        queueDepth.set(
          (dlqCounts.waiting ?? 0) + (dlqCounts.delayed ?? 0),
          { queue: DLQ_NAME, state: "waiting" }
        );
      }
    } catch (err) {
      logger.warn("Queue depth sample failed", { error: (err as Error).message });
    }
  }, QUEUE_DEPTH_SAMPLE_MS);
  depthInterval.unref?.();
}

export async function shutdownNotificationScheduler(): Promise<void> {
  try {
    if (depthInterval) clearInterval(depthInterval);
    await worker?.close();
    await queueEvents?.close();
    await queue?.close();
    await dlq?.close();
    await connection?.quit();
  } catch (err) {
    logger.error("Error shutting down notification scheduler", {
      error: (err as Error).message,
    });
  } finally {
    depthInterval = null;
    worker = null;
    queueEvents = null;
    queue = null;
    dlq = null;
    connection = null;
    started = false;
  }
}
