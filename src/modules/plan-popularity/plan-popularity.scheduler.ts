/**
 * Periodic "Most Popular" recompute: a cheap aggregate sweep on setInterval (not
 * BullMQ), once shortly after boot and then every PLAN_POPULARITY_REFRESH_HOURS
 * (default 24h). Never throws into the boot path.
 */
import logger from "../../utils/logger";
import { flushEntity } from "../../middlewares/autoFlush";
import { CacheEntity, resolveFlushGroup } from "../../middlewares/flushGroups";
import { recomputeAllPopularity } from "./plan-popularity.service";

const REFRESH_HOURS = Number(process.env.PLAN_POPULARITY_REFRESH_HOURS) || 24;
const INITIAL_DELAY_MS = 60_000; // let boot settle before the first sweep

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const changed = await recomputeAllPopularity();
    logger.info("[plan-popularity] recompute done", { changed });
    // The sweep writes straight to MySQL, so no autoFlush route middleware fires;
    // without an explicit flush the cached catalogs serve a stale badge for another
    // 24h TTL. Flush only when a flag flipped, to avoid cold-starting the cache nightly.
    const total = Object.values(changed).reduce((a, b) => a + b, 0);
    if (total > 0) {
      const entities = [...new Set([
        ...resolveFlushGroup(CacheEntity.Plan),
        ...resolveFlushGroup(CacheEntity.LiveCourse),
        // Client test-series reads are cached too.
        ...resolveFlushGroup(CacheEntity.TestSeries),
      ])];
      const cleared = await flushEntity(...entities);
      logger.info("[plan-popularity] flushed route cache after recompute", { changedRows: total, cleared });
    }
  } catch (err) {
    logger.error("[plan-popularity] recompute failed", { error: (err as Error).message });
  }
}

export function initPlanPopularityScheduler(): void {
  const intervalMs = REFRESH_HOURS * 60 * 60 * 1000;
  setTimeout(runOnce, INITIAL_DELAY_MS);
  timer = setInterval(runOnce, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
  logger.info("[plan-popularity] scheduler started", { refreshHours: REFRESH_HOURS });
}

export function stopPlanPopularityScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
