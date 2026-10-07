// StreamOS webhook ledger: scheduled prune of old delivery-id rows.
/**
 * Prunes `ws_streamos_webhook_delivery`, the delivery-id ledger that makes the v1
 * recording webhook idempotent. Retries are exhausted within minutes, so rows past
 * the retention window are dead weight.
 *
 * Deletes are batched, never one unbounded deleteMany: a large delete on a growing
 * table holds locks and can overwhelm the binlog (this took production down on the
 * is_login sweep). Each tick removes at most MAX_PER_TICK rows in DELETE_BATCH pages.
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
      // Select a page of ids, then delete by primary key.
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
