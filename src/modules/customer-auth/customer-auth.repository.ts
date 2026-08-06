import { prisma } from "../../config/prisma";
import type { CreateTokenInput } from "./customer-auth.types";

/**
 * Prisma persistence for the customer-auth MySQL branch.
 * Phone is stored as the 10-digit value (no country code), matching the dump
 * and the shared `formatPhone` helper.
 */
export const customerAuthRepository = {
  /** Active, non-deleted customer by phone (the login lookup). */
  findActiveByPhone: (phone: string) =>
    prisma.customer.findFirst({
      where: { phoneNumber: phone, isAccountDeleted: false },
    }),

  /** Same as above but also requires status=true (validate/refresh use this). */
  findLoginableByPhone: (phone: string) =>
    prisma.customer.findFirst({
      where: { phoneNumber: phone, isAccountDeleted: false, status: true },
    }),

  findLoginableById: (id: number) =>
    prisma.customer.findFirst({
      where: { id, isAccountDeleted: false, status: true },
    }),

  /**
   * Raw account gate state for the per-request authenticate check.
   * Returns just status + isAccountDeleted (no row filter) so the middleware
   * can tell "disabled" apart from "deleted". null = no such customer.
   */
  getAuthStateById: (id: number) =>
    prisma.customer.findUnique({
      where: { id },
      select: { status: true, isAccountDeleted: true },
    }),

  /**
   * Create a stub customer for a brand-new phone.
   * `state`/`district` are NOT NULL with no default in MySQL → default to 0.
   */
  createStub: (phone: string, otp: string, otpExpiresAt: Date) =>
    prisma.customer.create({
      data: {
        phoneNumber: phone,
        isPhoneVerified: false,
        verified: false,
        otp,
        otp_expires_at: otpExpiresAt,
        triedOtp: 0,
        lastLoginCount: 1,
        isAccountDeleted: false,
        status: true,
        stateId: 0,
        districtId: 0,
        rewardPoints: 0,
        os_type: "android",
      },
    }),

  /** Set/refresh OTP on an existing customer (generate path). */
  setOtpForLogin: (id: number, otp: string, otpExpiresAt: Date, loginCount: number) =>
    prisma.customer.update({
      where: { id },
      data: {
        otp,
        otp_expires_at: otpExpiresAt,
        triedOtp: 0,
        otpBlockedAt: null,
        lastLoginCount: loginCount,
      },
    }),

  /** Set/refresh OTP without bumping login count (resend path). */
  setOtpResend: (id: number, otp: string, otpExpiresAt: Date) =>
    prisma.customer.update({
      where: { id },
      data: { otp, otp_expires_at: otpExpiresAt, triedOtp: 0, otpBlockedAt: null },
    }),

  /** Record an OTP in the history table (ws_customer_otp). */
  recordOtp: (customerId: number, otp: string) =>
    prisma.customerOtp.create({
      data: { customerId, otp, created_at: new Date() },
    }),

  /** Bump the wrong-attempt counter (and optionally osType) on bad OTP. */
  bumpTriedOtp: (id: number, triedOtp: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: { triedOtp, ...(osType ? { os_type: osType as never } : {}) },
    }),

  /** Mark verified + clear tried counter on successful validate. */
  markVerified: (id: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: {
        isPhoneVerified: true,
        verified: true,
        triedOtp: 0,
        // `lastLogin` rides along on the existing UPDATE: a successful validateOtp
        // IS the login, and `login_count` was already being maintained without a
        // matching timestamp (you could see how often someone logged in, never
        // when). Stamped here rather than in a separate query.
        lastLogin: new Date(),
        isLoggedIn: true,
        ...(osType ? { os_type: osType as never } : {}),
      },
    }),

  /** Clear tried counter on a returning user's successful validate. */
  clearTried: (id: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: { triedOtp: 0, lastLogin: new Date(), isLoggedIn: true, ...(osType ? { os_type: osType as never } : {}) },
    }),

  /**
   * Clear the `is_login` flag on an explicit logout.
   *
   * Deliberately NOT folded into `deactivateTokens`: that runs mid-login too
   * (validateOtp deactivates the previous token before issuing the new one), so
   * clearing the flag there would immediately undo the login stamp above.
   */
  markLoggedOut: (id: number) =>
    prisma.customer.update({ where: { id }, data: { isLoggedIn: false } }),

  /**
   * One page of customers whose `is_login` is stale.
   *
   * `is_login` is derived state, so it drifts: a token simply expiring runs no
   * code, and an uninstall or a crash never reaches the logout route. Without
   * the reconcile sweep the flag would report customers as logged in
   * indefinitely. A row is stale when it is flagged `true` but holds no live
   * token (active, not-deleted, unexpired).
   *
   * NOTE: customers may hold several concurrent device sessions (the single-device
   * gate in authenticate.ts is disabled for them), so this is "has at least one
   * live session", which is the only thing one boolean can honestly express.
   *
   * Read-only and keyset-paginated (`id > afterId`, ordered by id) so the sweep
   * never runs one unbounded statement: the anti-join against
   * ws_customer_access_token over the whole ws_customer table is the expensive
   * half, and doing it as a bounded SELECT keeps it off the write path — no long
   * UPDATE holding row locks and inflating one binlog event. See the batched
   * loop in otp-unblock.scheduler.ts.
   */
  findStaleLoggedInIds: (now: Date, afterId: number, take: number) =>
    prisma.customer.findMany({
      where: {
        isLoggedIn: true,
        id: { gt: afterId },
        NOT: {
          customerAccessToken: {
            some: { active: true, deleted: false, expires_at: { gt: now } },
          },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take,
    }),

  /**
   * Clear `is_login` for one page of ids from `findStaleLoggedInIds`.
   *
   * The `isLoggedIn: true` guard is kept so the statement stays idempotent and
   * concurrency-safe: a customer who logged back in between the SELECT and this
   * UPDATE is simply skipped rather than being logged out under them, and a
   * second worker running the same page updates 0 rows.
   */
  clearLoggedInByIds: (ids: number[]) =>
    prisma.customer.updateMany({
      where: { id: { in: ids }, isLoggedIn: true },
      data: { isLoggedIn: false },
    }),

  /**
   * Block OTP login after too many wrong attempts: disable the account
   * (status=false), stamp the block time, and pin the tried counter at the cap.
   * The account is auto-restored 24h later by the otp-unblock sweep.
   */
  blockOtp: (id: number, attempts: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: {
        triedOtp: attempts,
        otpBlockedAt: new Date(),
        status: false,
        ...(osType ? { os_type: osType as never } : {}),
      },
    }),

  /**
   * Auto-unblock accounts whose OTP block is older than `cutoff`. Only touches
   * rows blocked by OTP (`otpBlockedAt` set AND older than cutoff) — an
   * admin-disabled account has `otpBlockedAt = null` and is left untouched.
   * Atomic + idempotent (safe to run concurrently); returns the affected count.
   */
  unblockExpiredOtp: (cutoff: Date) =>
    prisma.customer.updateMany({
      where: { status: false, otpBlockedAt: { lt: cutoff } },
      data: { status: true, otpBlockedAt: null, triedOtp: 0 },
    }),

  /** Invalidate every token for a customer (validate re-issue, logout). */
  deactivateTokens: (customerId: number) =>
    prisma.customerAccessToken.updateMany({
      where: { customerId },
      data: { active: false, deleted: true },
    }),

  /** Persist a freshly issued token pair. */
  createToken: (input: CreateTokenInput) =>
    prisma.customerAccessToken.create({
      data: {
        customerId: input.customerId,
        token: input.token,
        refreshToken: input.refreshToken,
        active: true,
        deleted: false,
        created_at: new Date(),
        expires_at: input.expiresAt,
      },
    }),

  /** Refresh-flow lookup: the active row matching this refresh token. */
  findActiveTokenByRefresh: (refreshToken: string, customerId: number) =>
    prisma.customerAccessToken.findFirst({
      where: { refreshToken, customerId, active: true, deleted: false },
    }),

  /** Invalidate a single token row by id (refresh rotation). */
  deactivateToken: (id: number) =>
    prisma.customerAccessToken.update({
      where: { id },
      data: { active: false, deleted: true },
    }),
};
