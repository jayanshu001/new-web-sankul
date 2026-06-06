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
        ...(osType ? { os_type: osType as never } : {}),
      },
    }),

  /** Clear tried counter on a returning user's successful validate. */
  clearTried: (id: number, osType?: string) =>
    prisma.customer.update({
      where: { id },
      data: { triedOtp: 0, ...(osType ? { os_type: osType as never } : {}) },
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
