/**
 * Customer-auth housekeeping sweep, two independent idempotent passes:
 *  1. OTP auto-unblock: restores accounts blocked by validateOtp once the block
 *     is older than OTP_BLOCK_HOURS.
 *  2. `is_login` reconciliation: expiry and uninstalls never reach logout, so
 *     clear the flag for anyone holding no live token.
 *
 * Not BullMQ and no Redis "is-running" flag: every statement is idempotent, so
 * concurrent runs across PM2 workers are harmless, and there is no stuck flag
 * to leave users blocked after a crash. Never throws into the boot path.
 */
import logger from "../../utils/logger";
import { isDatabaseUnavailableError } from "../../utils/dbAvailability";
import { customerAuthRepository } from "./customer-auth.repository";

const BLOCK_HOURS = Number(process.env.OTP_BLOCK_HOURS) || 24;
const SWEEP_MINUTES = Number(process.env.OTP_UNBLOCK_SWEEP_MINUTES) || 5;
const INITIAL_DELAY_MS = 30_000; // let boot settle before the first sweep

// Pass 2 is paged: one table-wide UPDATE with the token anti-join ran long enough
// in production that the server dropped the connection.
const RECONCILE_PAGE = 500;
const RECONCILE_MAX_PAGES = 20; // ≤ 10k rows per tick; the sweep repeats every 5 min

let timer: NodeJS.Timeout | null = null;

/**
 * Retry once on a dropped connection: pooled sockets idle between ticks get
 * reaped by the server, and the next query gets a fresh connection.
 */
async function withReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isDatabaseUnavailableError(err)) throw err;
    logger.warn("[otp-unblock] db connection dropped, retrying once", {
      error: (err as Error).message,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return fn();
  }
}

/** Capped at RECONCILE_MAX_PAGES per tick; the remainder is picked up next tick. */
async function reconcileLoggedOut(): Promise<number> {
  let afterId = 0;
  let cleared = 0;

  for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
    const rows = await withReconnect(() =>
      customerAuthRepository.findStaleLoggedInIds(afterId, RECONCILE_PAGE)
    );
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    afterId = ids[ids.length - 1];
    const { count } = await withReconnect(() => customerAuthRepository.clearLoggedInByIds(ids));
    cleared += count;

    if (rows.length < RECONCILE_PAGE) break;
  }

  return cleared;
}

async function runOnce(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - BLOCK_HOURS * 60 * 60 * 1000);
    const { count } = await withReconnect(() => customerAuthRepository.unblockExpiredOtp(cutoff));
    if (count > 0) logger.info("[otp-unblock] auto-unblocked accounts", { count });
  } catch (err) {
    logger.error("[otp-unblock] sweep failed", { error: (err as Error).message });
  }

  // Separate try so one pass failing never stops the other.
  try {
    const count = await reconcileLoggedOut();
    if (count > 0) logger.info("[is-login] cleared stale logged-in flags", { count });
  } catch (err) {
    logger.error("[is-login] reconcile failed", { error: (err as Error).message });
  }
}

// First sweep 30s after boot, then every OTP_UNBLOCK_SWEEP_MINUTES (timer unref'd).
export function initOtpUnblockScheduler(): void {
  const intervalMs = SWEEP_MINUTES * 60 * 1000;
  setTimeout(runOnce, INITIAL_DELAY_MS);
  timer = setInterval(runOnce, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  logger.info("[otp-unblock] scheduler started", { sweepMinutes: SWEEP_MINUTES, blockHours: BLOCK_HOURS });
}

export function stopOtpUnblockScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
