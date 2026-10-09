// PDF rendering off the API process (CODE_QUALITY_AUDIT PERF10). In an API replica
// (WORKER_ENABLED=false) a render becomes a BullMQ job for websankul-worker, which owns
// Chromium; the request waits for the bytes, so the HTTP response is unchanged. A process
// that runs workers itself (worker, single-process `yarn dev`) renders locally. If no
// worker is alive, or the job does not finish in time, the API renders locally as before.
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis, { Redis as RedisType } from "ioredis";
import logger from "../../utils/logger";
import { renderPdfLocally } from "./pdfBrowser";

const QUEUE_NAME = "pdf-render";
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const RENDERS_IN_THIS_PROCESS = process.env.WORKER_ENABLED !== "false";
// A render is ~1-3s; past this the API stops waiting and renders itself.
const WAIT_MS = 30_000;
// Same ceiling as pdfBrowser's MAX_CONCURRENT_PAGES.
const WORKER_CONCURRENCY = 3;
const WORKER_CHECK_TTL_MS = 10_000;

type PdfJob = { html: string };

let connection: RedisType | null = null;
let queue: Queue<PdfJob, string> | null = null;
let events: QueueEvents | null = null;
let worker: Worker<PdfJob, string> | null = null;
let workerSeen: { at: number; alive: boolean } | null = null;

// Dedicated ioredis connections, as every BullMQ queue here (never the cache client).
const buildConnection = (): RedisType =>
  new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, maxRetriesPerRequest: null, enableReadyCheck: false });

const ensureProducer = () => {
  if (!queue) {
    connection = connection ?? buildConnection();
    queue = new Queue<PdfJob, string>(QUEUE_NAME, { connection });
    events = new QueueEvents(QUEUE_NAME, { connection: buildConnection() });
  }
  return { queue, events: events! };
};

// Cached for WORKER_CHECK_TTL_MS so a render costs no extra Redis round trip.
const workerAlive = async (q: Queue<PdfJob, string>): Promise<boolean> => {
  if (workerSeen && Date.now() - workerSeen.at < WORKER_CHECK_TTL_MS) return workerSeen.alive;
  const alive = (await q.getWorkersCount()) > 0;
  workerSeen = { at: Date.now(), alive };
  return alive;
};

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  if (RENDERS_IN_THIS_PROCESS) return renderPdfLocally(html);
  let job: Job<PdfJob, string>;
  let jobEvents: QueueEvents;
  try {
    const { queue: q, events: e } = ensureProducer();
    if (!(await workerAlive(q))) return renderPdfLocally(html);
    job = await q.add("render", { html }, { removeOnComplete: { age: 60 }, removeOnFail: { age: 3600 } });
    jobEvents = e;
  } catch (err) {
    // Redis/queue trouble must never cost a receipt: render here, as before PERF10.
    logger.warn("pdf-render enqueue failed; rendering locally", { error: (err as Error).message });
    return renderPdfLocally(html);
  }
  try {
    return Buffer.from(await job.waitUntilFinished(jobEvents, WAIT_MS), "base64");
  } catch (err) {
    const msg = (err as Error).message ?? "";
    // A render error is final (local would fail the same way); only a wait timeout falls back.
    if (!/timed out/i.test(msg)) throw err;
    logger.warn("pdf-render wait timed out; rendering locally", { jobId: job.id });
    return renderPdfLocally(html);
  }
}

/** Worker side: render jobs from the API replicas. Started by startWorkers(). */
export async function initPdfRenderScheduler(): Promise<void> {
  if (worker) return;
  worker = new Worker<PdfJob, string>(
    QUEUE_NAME,
    async (job) => (await renderPdfLocally(job.data.html)).toString("base64"),
    { connection: buildConnection(), concurrency: WORKER_CONCURRENCY }
  );
  worker.on("failed", (job, err) => logger.error("pdf-render job failed", { jobId: job?.id, error: err.message }));
  worker.on("error", (err) => logger.error("pdf-render worker error", { error: err.message }));
  logger.info("BullMQ pdf-render worker started.");
}

export async function shutdownPdfRenderScheduler(): Promise<void> {
  try {
    await worker?.close();
    await events?.close();
    await queue?.close();
    await connection?.quit();
  } catch (err) {
    logger.error("Error shutting down pdf-render queue", { error: (err as Error).message });
  } finally {
    worker = null;
    events = null;
    queue = null;
    connection = null;
  }
}
