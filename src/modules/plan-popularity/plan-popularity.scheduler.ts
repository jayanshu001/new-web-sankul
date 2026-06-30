/**
 * Periodic recompute of the "Most Popular" pricing-plan flags. Lightweight
 * setInterval (not BullMQ) — this is a cheap aggregate sweep, not per-item work.
 * Runs once shortly after boot, then every PLAN_POPULARITY_REFRESH_HOURS (default
 * 24h). Admin pin/unpin recomputes its product immediately, so this just keeps
 * sales-driven flags fresh between pins. Never throws into the boot path.
 */
import logger from "../../utils/logger";
import { recomputeAllPopularity } from "./plan-popularity.service";

const REFRESH_HOURS = Number(process.env.PLAN_POPULARITY_REFRESH_HOURS) || 24;
const INITIAL_DELAY_MS = 60_000; // let boot settle before the first sweep

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const changed = await recomputeAllPopularity();
    logger.info("[plan-popularity] recompute done", { changed });
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
