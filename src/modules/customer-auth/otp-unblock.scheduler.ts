/**
 * Customer-auth housekeeping sweep. Two independent, idempotent passes:
 *
 *  1. OTP auto-unblock. After OTP_MAX_ATTEMPTS wrong OTP entries a customer is
 *     blocked (status=false, otpBlockedAt=now) by validateOtp. This restores any
 *     account whose block is older than OTP_BLOCK_HOURS (default 24h):
 *     status=true, otpBlockedAt=null, triedOtp=0.
 *  2. `is_login` reconciliation. The flag is set on login and cleared on logout,
 *     but token EXPIRY runs no code and an uninstall never reaches the logout
 *     route — so without this pass the flag would report customers as logged in
 *     forever. Clears it for anyone holding no live token.
 *
 * Deliberately NOT BullMQ and NOT guarded by a Redis "is-running" flag — every
 * statement here is an idempotent `updateMany`, so running it twice (or from
 * several PM2 workers) is harmless. This avoids the classic failure mode where a
 * stuck "running" flag (never reset after a mid-run crash) leaves users blocked
 * forever. Never throws into the boot path.
 *
 * Pass 2 is BATCHED (SELECT a page of ids → UPDATE that page) rather than one
 * table-wide `updateMany`. The unbounded form died in production with
 * "Server has closed the connection": a single UPDATE against ws_customer with a
 * relation anti-join over ws_customer_access_token ran long and wrote one large
 * transaction, and the server dropped the connection under it. Long-lived
 * dropped connections are also retried once (`withReconnect`), because a pool
 * connection idling between 5-minute ticks can be reaped by the server.
 */
import logger from "../../utils/logger";
import { isDatabaseUnavailableError } from "../../utils/dbAvailability";
import { customerAuthRepository } from "./customer-auth.repository";

const BLOCK_HOURS = Number(process.env.OTP_BLOCK_HOURS) || 24;
const SWEEP_MINUTES = Number(process.env.OTP_UNBLOCK_SWEEP_MINUTES) || 5;
const INITIAL_DELAY_MS = 30_000; // let boot settle before the first sweep

// `is_login` reconcile batching. The old sweep was ONE updateMany with a relation
// anti-join over the whole ws_customer table: on production that statement ran
// long enough (and wrote a large enough transaction) that the server dropped the
// connection under it — "Server has closed the connection." Paging keeps every
// statement short and bounded, and caps how much one tick can ever do.
const RECONCILE_PAGE = 500;
const RECONCILE_MAX_PAGES = 20; // ≤ 10k rows per tick; the sweep repeats every 5 min

let timer: NodeJS.Timeout | null = null;

/**
 * Run `fn`, retrying once after a short pause if the connection was dropped —
 * the pool handed out a socket the server had already closed (idle reap between
 * 5-minute ticks), or the server killed a long statement. The next query gets a
 * fresh connection, so one retry clears it; treating it as a hard error only
 * produces log noise for a fault that is expected at this cadence.
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

/**
 * Clear `is_login` for customers holding no live token, in bounded pages.
 *
 * SELECT a page of stale ids (keyset by id), UPDATE just those ids, repeat.
 * Stops at RECONCILE_MAX_PAGES so one tick can never turn into an unbounded
 * table sweep; whatever is left is picked up by the next tick. Returns the
 * number of rows actually cleared.
 */
async function reconcileLoggedOut(): Promise<number> {
  const now = new Date();
  let afterId = 0;
  let cleared = 0;

  for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
    const rows = await withReconnect(() =>
      customerAuthRepository.findStaleLoggedInIds(now, afterId, RECONCILE_PAGE)
    );
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    afterId = ids[ids.length - 1];
    const { count } = await withReconnect(() => customerAuthRepository.clearLoggedInByIds(ids));
    cleared += count;

    if (rows.length < RECONCILE_PAGE) break; // last page
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

  // `is_login` reconciliation shares this sweep: it is the same shape of problem
  // (derived state nothing else resets) and the same safety properties — every
  // statement idempotent, safe to run from several workers. Kept in its own try
  // so a failure here can never stop the OTP unblock above, and vice versa.
  try {
    const count = await reconcileLoggedOut();
    if (count > 0) logger.info("[is-login] cleared stale logged-in flags", { count });
  } catch (err) {
    logger.error("[is-login] reconcile failed", { error: (err as Error).message });
  }
}

export function initOtpUnblockScheduler(): void {
  const intervalMs = SWEEP_MINUTES * 60 * 1000;
  setTimeout(runOnce, INITIAL_DELAY_MS);
  timer = setInterval(runOnce, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
  logger.info("[otp-unblock] scheduler started", { sweepMinutes: SWEEP_MINUTES, blockHours: BLOCK_HOURS });
}

export function stopOtpUnblockScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
