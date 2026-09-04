/**
 * Prunes the StreamOS v1 webhook delivery-id ledger.
 *
 * `ws_streamos_webhook_delivery` exists to make the recording webhook idempotent:
 * v1 retries a failed delivery up to 6 times with the same X-Streamos-Delivery id,
 * and recording handling creates Video rows, so a replay would duplicate course
 * content. It therefore grows by one row per delivery, forever, unless something
 * trims it.
 *
 * Retries are exhausted within minutes, so a row older than the retention window
 * can no longer be replayed and is dead weight.
 *
 * Deletes are BATCHED — never one unbounded deleteMany. A single large delete on a
 * growing table is exactly the shape that took production down on the is_login
 * sweep: it holds locks and can overwhelm the binlog. Each tick removes at most
 * MAX_PER_TICK rows in DELETE_BATCH-sized pages and then stops until the next one.
 */
import logger from "../../utils/logger";
import { prisma } from "../../config/prisma";

const RETENTION_DAYS = Number(process.env.STREAMOS_DELIVERY_RETENTION_DAYS) || 30;
const SWEEP_HOURS = Number(process.env.STREAMOS_DELIVERY_SWEEP_HOURS) || 24;
const DELETE_BATCH = 500;
const MAX_PER_TICK = 10_000;
const INITIAL_DELAY_MS = 120_000; // let boot settle first

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;

    while (deleted < MAX_PER_TICK) {
      // Page the ids first, then delete that page by primary key — the same
      // select-then-write shape the is_login sweep had to adopt.
      const page = await prisma.streamosWebhookDelivery.findMany({
        where: { receivedAt: { lt: cutoff } },
        select: { id: true },
        take: DELETE_BATCH,
      });
      if (page.length === 0) break;

      const res = await prisma.streamosWebhookDelivery.deleteMany({
        where: { id: { in: page.map((r) => r.id) } },
      });
      deleted += res.count;
      if (page.length < DELETE_BATCH) break;
    }

    if (deleted > 0) {
      logger.info("[streamos-delivery] pruned webhook delivery ledger", { deleted, retentionDays: RETENTION_DAYS });
    }
  } catch (err) {
    // Never throw out of a background sweep — a failed prune is harmless.
    logger.error("[streamos-delivery] prune failed", { error: (err as Error).message });
  }
}

export function initStreamosDeliveryScheduler(): void {
  setTimeout(runOnce, INITIAL_DELAY_MS);
  timer = setInterval(runOnce, SWEEP_HOURS * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  logger.info("[streamos-delivery] scheduler started", {
    retentionDays: RETENTION_DAYS,
    sweepHours: SWEEP_HOURS,
  });
}

export function stopStreamosDeliveryScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
