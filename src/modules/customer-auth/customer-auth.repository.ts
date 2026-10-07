// Customer auth: Prisma queries for OTP login, login state and access tokens.
import { prisma } from "../../config/prisma";
import type { CreateTokenInput } from "./customer-auth.types";

/** Phone is stored as the 10-digit value (no country code), as `formatPhone` produces. */
export const customerAuthRepository = {
  findActiveByPhone: (phone: string) =>
    prisma.customer.findFirst({
      where: { phoneNumber: phone, isAccountDeleted: false },
    }),

  findLoginableByPhone: (phone: string) =>
    prisma.customer.findFirst({
      where: { phoneNumber: phone, isAccountDeleted: false, status: true },
    }),

  findLoginableById: (id: number) =>
    prisma.customer.findFirst({
      where: { id, isAccountDeleted: false, status: true },
    }),

  /**
   * Unfiltered so the per-request auth gate can tell "disabled" from "deleted".
   * null = no such customer.
   */
  getAuthStateById: (id: number) =>
    prisma.customer.findUnique({
      where: { id },
      select: { status: true, isAccountDeleted: true },
    }),

  /**
   * Makes ws_customer_access_token authoritative: `authenticate` rejects a
   * customer with no live row, so revoking rows signs the device out.
   *
   * Existence-only `findFirst`, covered by the prefix of
   * idx_cust_access_token_live; without that index this full-scans on every
   * authenticated request. `expires_at` is deliberately not checked: customer
   * sessions end only by logout, account disable or delete.
   */
  findLiveTokenId: (customerId: number) =>
    prisma.customerAccessToken.findFirst({
      where: { customerId, active: true, deleted: false },
      select: { id: true },
    }),

  /** `state`/`district` are NOT NULL with no default, so they start at 0. */
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

  /** Resend path: does not bump login count. */
  setOtpResend: (id: number, otp: string, otpExpiresAt: Date) =>
    prisma.customer.update({
      where: { id },
      data: { otp, otp_expires_at: otpExpiresAt, triedOtp: 0, otpBlockedAt: null },
    }),

  recordOtp: (customerId: number, otp: string) =>
    prisma.customerOtp.create({
      data: { customerId, otp, created_at: new Date() },
    }),

  bumpTriedOtp: (id: number, triedOtp: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: { triedOtp, ...(osType ? { os_type: osType as never } : {}) },
    }),

  markVerified: (id: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: {
        isPhoneVerified: true,
        verified: true,
        triedOtp: 0,
        // A successful validateOtp is the login, so stamp it here.
        lastLogin: new Date(),
        isLoggedIn: true,
        ...(osType ? { os_type: osType as never } : {}),
      },
    }),

  clearTried: (id: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: { triedOtp: 0, lastLogin: new Date(), isLoggedIn: true, ...(osType ? { os_type: osType as never } : {}) },
    }),

  /**
   * Not folded into `deactivateTokens`: that also runs mid-login (validateOtp
   * revokes the previous token), so clearing the flag there would undo the login.
   */
  markLoggedOut: (id: number) =>
    prisma.customer.update({ where: { id }, data: { isLoggedIn: false } }),

  /**
   * One page of customers flagged `is_login` but holding no live token. The flag
   * drifts because expiry, uninstalls and crashes never reach logout.
   *
   * Keyset-paginated read so the expensive anti-join never runs as one unbounded
   * UPDATE (long row locks, huge binlog event). See otp-unblock.scheduler.ts.
   */
  findStaleLoggedInIds: (afterId: number, take: number) =>
    prisma.customer.findMany({
      where: {
        isLoggedIn: true,
        id: { gt: afterId },
        // Same "live row" predicate as findLiveTokenId — no expires_at.
        NOT: {
          customerAccessToken: {
            some: { active: true, deleted: false },
          },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take,
    }),

  /**
   * The `isLoggedIn: true` guard keeps this idempotent: a customer who logged
   * back in since the SELECT is skipped, and a concurrent worker updates 0 rows.
   */
  clearLoggedInByIds: (ids: number[]) =>
    prisma.customer.updateMany({
      where: { id: { in: ids }, isLoggedIn: true },
      data: { isLoggedIn: false },
    }),

  /** Disables the account; the otp-unblock sweep restores it after the block window. */
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
   * Only rows blocked by OTP: an admin-disabled account has `otpBlockedAt = null`
   * and is left alone. Idempotent; safe to run concurrently.
   */
  unblockExpiredOtp: (cutoff: Date) =>
    prisma.customer.updateMany({
      where: { status: false, otpBlockedAt: { lt: cutoff } },
      data: { status: true, otpBlockedAt: null, triedOtp: 0 },
    }),

  deactivateTokens: (customerId: number) =>
    prisma.customerAccessToken.updateMany({
      where: { customerId },
      data: { active: false, deleted: true },
    }),

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

  findActiveTokenByRefresh: (refreshToken: string, customerId: number) =>
    prisma.customerAccessToken.findFirst({
      where: { refreshToken, customerId, active: true, deleted: false },
    }),

  deactivateToken: (id: number) =>
    prisma.customerAccessToken.update({
      where: { id },
      data: { active: false, deleted: true },
    }),
};
