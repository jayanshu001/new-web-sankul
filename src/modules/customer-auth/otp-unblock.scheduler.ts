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
 * Deliberately NOT BullMQ and NOT guarded by a Redis "is-running" flag — the whole
 * sweep is a single atomic, idempotent `updateMany`, so running it twice (or from
 * several PM2 workers) is harmless. This avoids the classic failure mode where a
 * stuck "running" flag (never reset after a mid-run crash) leaves users blocked
 * forever. Never throws into the boot path.
 */
import logger from "../../utils/logger";
import { customerAuthRepository } from "./customer-auth.repository";

const BLOCK_HOURS = Number(process.env.OTP_BLOCK_HOURS) || 24;
const SWEEP_MINUTES = Number(process.env.OTP_UNBLOCK_SWEEP_MINUTES) || 5;
const INITIAL_DELAY_MS = 30_000; // let boot settle before the first sweep

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - BLOCK_HOURS * 60 * 60 * 1000);
    const { count } = await customerAuthRepository.unblockExpiredOtp(cutoff);
    if (count > 0) logger.info("[otp-unblock] auto-unblocked accounts", { count });
  } catch (err) {
    logger.error("[otp-unblock] sweep failed", { error: (err as Error).message });
  }

  // `is_login` reconciliation shares this sweep: it is the same shape of problem
  // (derived state nothing else resets) and the same safety properties — one
  // atomic idempotent updateMany. Kept in its own try so a failure here can never
  // stop the OTP unblock above, and vice versa.
  try {
    const { count } = await customerAuthRepository.reconcileLoggedOut(new Date());
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
