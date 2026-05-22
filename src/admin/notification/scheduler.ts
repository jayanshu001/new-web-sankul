import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import { Notification } from "../../models/system/Notification.model";
import { dispatchScheduledById } from "./dispatcher";
import logger from "../../utils/logger";
import { queueDepth, queueDlqTotal } from "../../utils/metrics";

const QUEUE_NAME = "notification-scheduler";
const DLQ_NAME = "notification-scheduler-dlq";
// Sample queue depth this often. Cheap (4 LRANGEs) and infrequent enough
// not to be its own load source.
const QUEUE_DEPTH_SAMPLE_MS = 15_000;

// Backpressure: refuse new schedules when the queue is already this deep.
// Why this matters: with no upper bound, a bug that schedules notifications
// in a tight loop (or a real surge: 100k students × a "system maintenance"
// blast) would push BullMQ's waiting list into hundreds of MB of Redis
// memory and degrade every other tenant of the same Redis instance. The
// limit is a soft ceiling — operators can override per-call with the
// `bypassBackpressure` option, which is what the boot-time rehydrate uses
// because that's not new work, it's recovery of work that already existed.
const QUEUE_DEPTH_LIMIT = Number(process.env.NOTIFICATION_QUEUE_DEPTH_LIMIT) || 10_000;

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

interface NotificationJobData {
  notificationId: string;
}

let queue: Queue<NotificationJobData> | null = null;
let dlq: Queue<NotificationJobData & { lastError: string }> | null = null;
let worker: Worker<NotificationJobData> | null = null;
let queueEvents: QueueEvents | null = null;
let connection: RedisType | null = null;
let depthInterval: NodeJS.Timeout | null = null;
let started = false;

/**
 * BullMQ requires a dedicated ioredis connection with `maxRetriesPerRequest: null`
 * and `enableReadyCheck: false`. Do NOT reuse the shared session/cache redisClient,
 * which has retries enabled.
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

export function getNotificationQueue(): Queue<NotificationJobData> {
  if (!queue) throw new Error("Notification scheduler not initialised. Call initNotificationScheduler() first.");
  return queue;
}

/**
 * Thrown by `scheduleNotificationJob` when the queue is over its depth
 * limit. Controllers should map this to HTTP 503 with `Retry-After`.
 */
export class QueueBackpressureError extends Error {
  constructor(public readonly depth: number, public readonly limit: number) {
    super(`Notification queue is at ${depth}/${limit} — try again later.`);
    this.name = "QueueBackpressureError";
  }
}

export interface ScheduleOptions {
  /** Skip the queue-depth backpressure check (boot rehydrate, admin
   *  retries). Default false. */
  bypassBackpressure?: boolean;
}

/**
 * Enqueue a scheduled notification. Job id is the notification's _id so we can
 * deterministically cancel/remove it and so duplicate enqueues (e.g. boot
 * rehydrate after a controller already enqueued) are no-ops.
 *
 * Backpressure: refuses new schedules once the waiting + delayed count
 * exceeds `QUEUE_DEPTH_LIMIT` (env-tunable). The boot rehydrate path passes
 * `bypassBackpressure: true` because that's recovery work, not new load.
 */
export async function scheduleNotificationJob(
  notificationId: string,
  scheduledAt: Date,
  options: ScheduleOptions = {}
): Promise<void> {
  if (!queue) throw new Error("Notification scheduler not initialised.");
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

  // Backpressure check. Cheap — single Redis HGETALL via BullMQ.
  if (!options.bypassBackpressure) {
    try {
      const counts = await queue.getJobCounts("waiting", "delayed");
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
      // Don't let a Redis blip during the depth check block writes. Re-throw
      // backpressure errors but swallow anything else.
      if (err instanceof QueueBackpressureError) throw err;
    }
  }

  // Remove any stale job for the same id (e.g. user rescheduled). BullMQ will
  // throw if a job with the same id already exists in a different state.
  try {
    const existing = await queue.getJob(notificationId);
    if (existing) await existing.remove();
  } catch {
    // ignore — getJob can throw if job is in a locked state; add() below will
    // either succeed or surface the real error.
  }

  await queue.add(
    "dispatch",
    { notificationId },
    {
      jobId: notificationId,
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    }
  );
}

/**
 * Remove a scheduled job (cancel path). Safe to call if the job no longer exists.
 */
export async function cancelNotificationJob(notificationId: string): Promise<void> {
  if (!queue) return;
  const job = await queue.getJob(notificationId);
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

/**
 * Boot-time rehydrate: enqueue every notification still in "scheduled" status.
 * BullMQ's deterministic jobId (notification._id) makes this idempotent — if
 * the queue already has the job, the second add() is a no-op.
 */
async function rehydrateScheduledNotifications(): Promise<number> {
  const rows = await Notification.find({ status: "scheduled" })
    .select("_id scheduledAt")
    .lean();

  let count = 0;
  for (const row of rows) {
    if (!row.scheduledAt) continue;
    try {
      // bypassBackpressure: this is recovery of work that already existed
      // before the restart, not new client-driven load. Refusing the row
      // would lose it permanently (status flips to "failed" via the worker
      // never picking it up).
      await scheduleNotificationJob(String(row._id), row.scheduledAt, {
        bypassBackpressure: true,
      });
      count++;
    } catch (err) {
      logger.error("Rehydrate: failed to enqueue scheduled notification", {
        id: String(row._id),
        error: (err as Error).message,
      });
    }
  }
  return count;
}

export async function initNotificationScheduler(): Promise<void> {
  if (started) return;
  started = true;

  connection = buildConnection();

  queue = new Queue<NotificationJobData>(QUEUE_NAME, { connection });
  // DLQ: when a job exhausts its retries we push a copy here with the last
  // error attached. The DLQ has no worker — it's a forensics inbox you can
  // drain manually via the admin tooling (or replay back into the main
  // queue after fixing the root cause).
  dlq = new Queue<NotificationJobData & { lastError: string }>(DLQ_NAME, {
    connection: buildConnection(),
  });

  worker = new Worker<NotificationJobData>(
    QUEUE_NAME,
    async (job: Job<NotificationJobData>) => {
      const { notificationId } = job.data;
      const result = await dispatchScheduledById(notificationId);
      if (!result) {
        // Row was already claimed/cancelled — drop silently.
        return { skipped: true };
      }
      if (result.status === "failed") {
        // Trigger BullMQ retry by throwing — dispatcher already rolled the
        // row back to "scheduled".
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
    // Final failure (all retries exhausted) → mark the row failed permanently
    // AND push a copy onto the DLQ for forensics.
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        await Notification.updateOne(
          { _id: job.data.notificationId, status: "scheduled" },
          { $set: { status: "failed", failureReason: err.message } }
        );
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
              jobId: `dlq:${job.id}`,
              removeOnComplete: false,
              // DLQ items never expire automatically — they're meant to be
              // inspected and replayed by hand. Cap retention to 30 days.
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

  const rehydrated = await rehydrateScheduledNotifications();
  logger.info("BullMQ notification scheduler started.", { rehydrated });

  // Sample queue depth periodically and publish to the /metrics registry.
  // BullMQ exposes per-state job counts cheaply via getJobCounts().
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
      // Sampling failures shouldn't crash the worker. Log + move on.
      logger.warn("Queue depth sample failed", { error: (err as Error).message });
    }
  }, QUEUE_DEPTH_SAMPLE_MS);
  // Don't keep the event loop alive for the sampler alone.
  depthInterval.unref?.();
}

/**
 * Graceful shutdown — close worker, queue events, queue, and the dedicated
 * Redis connections. Useful for tests and process signals.
 */
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
