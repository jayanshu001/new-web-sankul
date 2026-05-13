import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import { Notification } from "../../models/system/Notification.model";
import { dispatchScheduledById } from "./dispatcher";
import logger from "../../utils/logger";

const QUEUE_NAME = "notification-scheduler";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

interface NotificationJobData {
  notificationId: string;
}

let queue: Queue<NotificationJobData> | null = null;
let worker: Worker<NotificationJobData> | null = null;
let queueEvents: QueueEvents | null = null;
let connection: RedisType | null = null;
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
 * Enqueue a scheduled notification. Job id is the notification's _id so we can
 * deterministically cancel/remove it and so duplicate enqueues (e.g. boot
 * rehydrate after a controller already enqueued) are no-ops.
 */
export async function scheduleNotificationJob(
  notificationId: string,
  scheduledAt: Date
): Promise<void> {
  if (!queue) throw new Error("Notification scheduler not initialised.");
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

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
      await scheduleNotificationJob(String(row._id), row.scheduledAt);
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
    // Final failure (all retries exhausted) → mark the row failed permanently.
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
}

/**
 * Graceful shutdown — close worker, queue events, queue, and the dedicated
 * Redis connections. Useful for tests and process signals.
 */
export async function shutdownNotificationScheduler(): Promise<void> {
  try {
    await worker?.close();
    await queueEvents?.close();
    await queue?.close();
    await connection?.quit();
  } catch (err) {
    logger.error("Error shutting down notification scheduler", {
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
