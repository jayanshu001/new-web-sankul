import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import { setContentStatus } from "../../modules/jobs-content/content.service";
import { contentRepository } from "../../modules/jobs-content/content.repository";
import { removeManyFromSearchIndex } from "../../modules/jobs-search/search.service";
import logger from "../../utils/logger";

// Two clock-driven transitions nothing else triggers: flipping a scheduled
// post to published at its publishedAt time, and expiring a job posting past
// its application deadline. Modeled on admin/exports/export.scheduler.ts.

const QUEUE_NAME = "jobs-content-lifecycle";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const PUBLISH_SCHEDULED = "publish-scheduled";
const EXPIRE_SWEEP = "expire-sweep";
const EXPIRE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

interface JobsLifecycleData {
  contentId?: string;
}

let queue: Queue<JobsLifecycleData> | null = null;
let worker: Worker<JobsLifecycleData> | null = null;
let queueEvents: QueueEvents | null = null;
let connection: RedisType | null = null;
let started = false;

function buildConnection(): RedisType {
  return new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, maxRetriesPerRequest: null, enableReadyCheck: false });
}

function ensureProducer(): Queue<JobsLifecycleData> {
  if (!queue) {
    connection = connection ?? buildConnection();
    queue = new Queue<JobsLifecycleData>(QUEUE_NAME, { connection });
  }
  return queue;
}

/** Enqueued whenever content is saved with status="scheduled" and a future
 * publishedAt. jobId is content-scoped so re-saving with a new publishedAt
 * replaces the pending job instead of stacking duplicates. */
export async function scheduleContentPublish(contentId: string, publishedAt: Date): Promise<void> {
  const q = ensureProducer();
  const jobId = `pub-${contentId}`;
  await q.remove(jobId).catch(() => {});
  const delay = Math.max(0, publishedAt.getTime() - Date.now());
  await q.add(
    PUBLISH_SCHEDULED,
    { contentId },
    { jobId, delay, removeOnComplete: true, removeOnFail: { count: 1000 } }
  );
}

export async function cancelScheduledPublish(contentId: string): Promise<void> {
  const q = ensureProducer();
  await q.remove(`pub-${contentId}`).catch(() => {});
}

async function scheduleExpireSweep(): Promise<void> {
  const q = ensureProducer();
  await q.add(
    EXPIRE_SWEEP,
    {},
    { jobId: "expire-sweep", repeat: { every: EXPIRE_SWEEP_INTERVAL_MS }, removeOnComplete: true, removeOnFail: { count: 100 } }
  );
}

async function runExpireSweep(): Promise<void> {
  const staleIds = await contentRepository.findStaleJobIds(new Date());
  if (staleIds.length === 0) return;
  await contentRepository.bulkSetStatus(staleIds, "expired");
  await removeManyFromSearchIndex("job", staleIds);
  logger.info("[jobs-scheduler] expired stale job postings", { count: staleIds.length });
}

async function processJob(job: Job<JobsLifecycleData>): Promise<void> {
  if (job.name === EXPIRE_SWEEP) {
    await runExpireSweep();
    return;
  }
  if (job.name === PUBLISH_SCHEDULED && job.data.contentId) {
    await setContentStatus(job.data.contentId, "published");
  }
}

export async function initJobsScheduler(): Promise<void> {
  if (started) return;
  started = true;

  ensureProducer();

  worker = new Worker<JobsLifecycleData>(QUEUE_NAME, processJob, {
    connection: buildConnection(),
    concurrency: 2,
  });
  queueEvents = new QueueEvents(QUEUE_NAME, { connection: buildConnection() });

  worker.on("failed", (job, err) => {
    logger.error("Jobs lifecycle job failed", { jobId: job?.id, error: err.message });
  });
  worker.on("error", (err) => logger.error("Jobs lifecycle worker error", { error: err.message }));

  await scheduleExpireSweep();
  logger.info("BullMQ jobs-content-lifecycle scheduler started.");
}

export async function shutdownJobsScheduler(): Promise<void> {
  try {
    await worker?.close();
    await queueEvents?.close();
    await queue?.close();
    await connection?.quit();
  } catch (err) {
    logger.error("Error shutting down jobs scheduler", { error: (err as Error).message });
  } finally {
    worker = null;
    queueEvents = null;
    queue = null;
    connection = null;
    started = false;
  }
}
