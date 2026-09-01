/**
 * Periodic recompute of the "Most Popular" pricing-plan flags. Lightweight
 * setInterval (not BullMQ) — this is a cheap aggregate sweep, not per-item work.
 * Runs once shortly after boot, then every PLAN_POPULARITY_REFRESH_HOURS (default
 * 24h). Admin pin/unpin recomputes its product immediately, so this just keeps
 * sales-driven flags fresh between pins. Never throws into the boot path.
 */
import logger from "../../utils/logger";
import { flushEntity } from "../../middlewares/autoFlush";
import { resolveFlushGroup } from "../../middlewares/flushGroups";
import { recomputeAllPopularity } from "./plan-popularity.service";

const REFRESH_HOURS = Number(process.env.PLAN_POPULARITY_REFRESH_HOURS) || 24;
const INITIAL_DELAY_MS = 60_000; // let boot settle before the first sweep

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const changed = await recomputeAllPopularity();
    logger.info("[plan-popularity] recompute done", { changed });
    // This sweep is the ONLY thing that moves the badge (the pin override has no
    // admin UI by design), and it writes straight to MySQL — no HTTP write, so no
    // autoFlush route middleware ever fires. Without this the client catalogs keep
    // serving yesterday's badge for a further 24h TTL, i.e. up to 48h stale.
    // Only sweep when a flag actually flipped: the steady state is 0 changes, and
    // flushing every night would needlessly cold-start the whole catalog cache.
    const total = Object.values(changed).reduce((a, b) => a + b, 0);
    if (total > 0) {
      const entities = [...new Set([
        ...resolveFlushGroup("plan"),
        ...resolveFlushGroup("live-course"),
        // ws_test_series_price is one of the five popularity scopes, and the
        // client test-series reads ARE cached (tagged "test-series"), so the
        // badge needs the same sweep as the other four.
        ...resolveFlushGroup("test-series"),
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
  // First sweep shortly after boot, then on the interval.
  setTimeout(runOnce, INITIAL_DELAY_MS);
  timer = setInterval(runOnce, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
  logger.info("[plan-popularity] scheduler started", { refreshHours: REFRESH_HOURS });
}

export function stopPlanPopularityScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
