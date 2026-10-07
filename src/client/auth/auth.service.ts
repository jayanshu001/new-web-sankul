// Client auth: OTP send/verify, JWT issue/rotate and logout logic.
import logger from "../../utils/logger";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { redisClient } from "../../config/redis";
import { isDatabaseUnavailableError } from "../../utils/dbAvailability";
import { revokeAllTokensForUser } from "../../libs/tokenRevocation";
import { customerAuthRepository } from "../../modules/customer-auth/customer-auth.repository";
import {
  toCustomerProfileDto,
  isProfileCompleteMysql,
} from "../../modules/customer-auth/customer-auth.transformer";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
// Block duration after OTP_MAX_ATTEMPTS wrong entries. The otp-unblock scheduler
// reads the same OTP_BLOCK_HOURS env, so the two stay in sync.
const OTP_BLOCK_HOURS = Number(process.env.OTP_BLOCK_HOURS) || 24;
const LOGIN_MAX_ATTEMPTS = 20;
// Test numbers always get static OTP
const TESTING_ACCOUNTS: string[] = (process.env.TESTING_PHONE_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);
const STATIC_OTP = "5786";

// QA/dev only: every signup/login gets a fixed OTP and SMS is skipped.
// Must stay off in production (opt-in via env).
const DUMMY_OTP_ENABLED = process.env.DUMMY_OTP_ENABLED === "true";
const DUMMY_OTP_VALUE = process.env.DUMMY_OTP_VALUE || "1234";
if (DUMMY_OTP_ENABLED) {
  logger.warn(
    `[AUTH] DUMMY_OTP_ENABLED is ON — all OTPs are "${DUMMY_OTP_VALUE}" and SMS is skipped. Do NOT use in production.`
  );
}

const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
// Customer sessions have no time ceiling: neither JWT carries `exp` and
// `authenticate` ignores expires_at. Only logout / disable / delete end a session.
// This TTL only fills the NOT NULL expires_at column and the EX of the
// write-only `customer_session:*` Redis key.
const JWT_REFRESH_TTL_DAYS = 60;

function addMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function formatPhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

// Send the OTP via 2Factor SMS; skipped (treated as sent) when unconfigured.
async function sendOtpSms(phone: string, otp: string): Promise<boolean> {
  const base = process.env.TWO_FACTOR_BASE_URL;
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  if (!base || !apiKey) {
    console.warn("[SMS] 2Factor base url / api key not set — skipping send, OTP:", otp);
    return true; // dev fallback
  }
  // The 2Factor template name can contain spaces; unencoded, axios throws and
  // the OTP silently fails to send.
  const template = encodeURIComponent(process.env.TWO_FACTOR_WEBSANKUL_OTP_TEMPLATE ?? "");
  const hash = encodeURIComponent(process.env.TWO_FACTOR_OTP_HASH_CODE ?? "");
  const url = `${base}${apiKey}/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(otp)}/${template}?var1=${hash}`;
  try {
    const { default: axios } = await import("axios");
    const resp = await axios.get(url, {
      params: {
        mobile: phone,
        otp,
      },
      timeout: 10_000,
    });
    const status: string = (resp.data as any)?.Status ?? "";
    return status === "Success";
  } catch (err) {
    console.error("[SMS] failed:", err);
    return false;
  }
}

/** Generates and sends an OTP, creating the customer record on first signup. */
export async function generateOtp(rawPhone: string, traceId?: string): Promise<{
  ok: boolean;
  message: string;
  isNewUser?: boolean;
}> {
  logger.info("generateOtp service invoked", { traceId, rawPhone });
  const phone = formatPhone(rawPhone);
  const isStatic = TESTING_ACCOUNTS.includes(phone);

  const otpFor = () =>
    DUMMY_OTP_ENABLED
      ? DUMMY_OTP_VALUE
      : isStatic
      ? STATIC_OTP
      : String(Math.floor(1000 + Math.random() * 8999));

  const row = await customerAuthRepository.findActiveByPhone(phone);
  if (row && !row.status) {
    logger.warn("generateOtp service account blocked", { traceId, phone });
    return { ok: false, message: "Your account has been blocked, please contact the helpline number." };
  }

  const otp = otpFor();
  console.log(`\x1b[1m\x1b[38;5;50m[OTP]\x1b[0m \x1b[38;5;208mGenerated\x1b[0m → \x1b[1m\x1b[38;5;226m${otp}\x1b[0m`);
  const sent = DUMMY_OTP_ENABLED || isStatic || (await sendOtpSms(phone, otp));
  if (!sent) {
    return { ok: false, message: "Unable to send OTP. Please try again later." };
  }

  const expiresAt = addMinutes(OTP_TTL_MINUTES);
  let isNewUser = false;
  let customerId: number;
  if (row) {
    await customerAuthRepository.setOtpForLogin(
      row.id,
      otp,
      expiresAt,
      (row.lastLoginCount ?? 0) + 1
    );
    customerId = row.id;
    logger.info("generateOtp service existing user OTP updated", { traceId, phone, customerId });
  } else {
    // Fresh signup. Soft-deleted rows for the same phone stay untouched;
    // uq_customer_phone_active allows this because they expose NULL phone_active.
    isNewUser = true;
    try {
      const created = await customerAuthRepository.createStub(phone, otp, expiresAt);
      customerId = created.id;
      logger.info("generateOtp service new user created", { traceId, phone, customerId });
    } catch (err: any) {
      // P2002 = concurrent signup raced us to the single active slot.
      if (err?.code === "P2002") {
        logger.warn("generateOtp service duplicate active phone race condition", { traceId, phone });
        return { ok: false, message: "Please wait before requesting a new OTP." };
      }
      throw err;
    }
  }
  await customerAuthRepository.recordOtp(customerId, otp);
  logger.info("generateOtp service completed", { traceId, phone, isNewUser });
  return { ok: true, message: "OTP sent successfully.", isNewUser };
}

/** Resends an OTP to an existing customer, limited to one send per 60 seconds. */
export async function resendOtp(rawPhone: string, traceId?: string): Promise<{
  ok: boolean;
  message: string;
}> {
  logger.info("resendOtp service invoked", { traceId, rawPhone });
  const phone = formatPhone(rawPhone);
  const isStatic = TESTING_ACCOUNTS.includes(phone);

  const otpForResend = () =>
    DUMMY_OTP_ENABLED
      ? DUMMY_OTP_VALUE
      : isStatic
      ? STATIC_OTP
      : String(Math.floor(1000 + Math.random() * 8999));

  const row = await customerAuthRepository.findActiveByPhone(phone);
  if (!row) {
    logger.warn("resendOtp service user not found", { traceId, phone });
    return { ok: false, message: "User not found. Please register first." };
  }
  if (!row.status) {
    return { ok: false, message: "Your account has been blocked, please contact the helpline number." };
  }
  // Last send time is derived from otp_expires_at.
  if (row.otp_expires_at && row.otp_expires_at > new Date()) {
    const msUntilExpiry = row.otp_expires_at.getTime() - Date.now();
    const msSinceLastSend = OTP_TTL_MINUTES * 60 * 1000 - msUntilExpiry;
    if (msSinceLastSend < 60000) {
      const waitSecs = Math.ceil((60000 - msSinceLastSend) / 1000);
      return { ok: false, message: `Please wait ${waitSecs} seconds before resending OTP.` };
    }
  }
  const otp = otpForResend();
  const sent = DUMMY_OTP_ENABLED || isStatic || (await sendOtpSms(phone, otp));
  if (!sent) {
    return { ok: false, message: "Unable to resend OTP. Please try again later." };
  }
  const expiresAt = addMinutes(OTP_TTL_MINUTES);
  await customerAuthRepository.setOtpResend(row.id, otp, expiresAt);
  await customerAuthRepository.recordOtp(row.id, otp);
  logger.info("resendOtp service completed", { traceId, customerId: row.id });
  return { ok: true, message: "A new OTP has been sent." };
}

// Verify the OTP (blocks after max wrong tries), then issue a fresh token pair.
export async function validateOtp(
  rawPhone: string,
  otp: string,
  osType?: string,
  traceId?: string
): Promise<{
  ok: boolean;
  message: string;
  token?: string;
  refreshToken?: string;
  customer?: Record<string, unknown>;
  isNewUser?: boolean;
}> {
  logger.info("validateOtp service invoked", { traceId, rawPhone, otp });
  const phone = formatPhone(rawPhone);

  const row = await customerAuthRepository.findLoginableByPhone(phone);
  if (!row) {
    logger.warn("validateOtp service invalid user", { traceId, phone });
    return { ok: false, message: "Invalid user." };
  }

  const triedOtp = (row.triedOtp ?? 0) + 1;

  // Constant-time comparison; OTP length is fixed, so the length check leaks nothing.
  const otpBuf = Buffer.from(String(row.otp ?? ""), "utf8");
  const inputBuf = Buffer.from(String(otp ?? ""), "utf8");
  const otpMismatch = otpBuf.length !== inputBuf.length || !crypto.timingSafeEqual(otpBuf, inputBuf);
  if (otpMismatch) {
    // On the last allowed wrong entry, block the account (status=false). Since
    // findLoginableByPhone requires status=true, further attempts return
    // "Invalid user." until the otp-unblock sweep restores it.
    if (triedOtp >= OTP_MAX_ATTEMPTS) {
      await customerAuthRepository.blockOtp(row.id, OTP_MAX_ATTEMPTS, osType);
      logger.warn("validateOtp service account blocked (too many wrong OTPs)", { traceId, customerId: row.id });
      return {
        ok: false,
        message: `Due to too many wrong attempts, your account has been blocked for ${OTP_BLOCK_HOURS} hours.`,
      };
    }
    await customerAuthRepository.bumpTriedOtp(row.id, triedOtp, osType);
    const remaining = OTP_MAX_ATTEMPTS - triedOtp;
    logger.warn("validateOtp service wrong otp", { traceId, customerId: row.id, remaining });
    return { ok: false, message: `Invalid OTP. ${remaining} attempt(s) remaining.` };
  }

  if (!row.otp_expires_at || row.otp_expires_at < new Date()) {
    logger.warn("validateOtp service otp expired", { traceId, customerId: row.id });
    return { ok: false, message: "OTP has expired. Please request a new one." };
  }

  const isNewUser = !row.verified;
  const profileCompleted = isProfileCompleteMysql(row);

  if (!row.isPhoneVerified || !row.verified) {
    await customerAuthRepository.markVerified(row.id, osType);
  } else {
    await customerAuthRepository.clearTried(row.id, osType);
  }

  await customerAuthRepository.deactivateTokens(row.id);

  const idStr = String(row.id);
  const token = jwt.sign(
    { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
    JWT_SECRET
  );
  const refreshToken = jwt.sign(
    { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
    JWT_REFRESH_SECRET
  );

  await customerAuthRepository.createToken({
    customerId: row.id,
    token,
    refreshToken,
    expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
  });

  await redisClient.set(
    `customer_session:${idStr}`,
    token,
    "EX",
    JWT_REFRESH_TTL_DAYS * 24 * 60 * 60
  );

  const profile = toCustomerProfileDto(row, { isNewUser, isProfileCompleted: profileCompleted });

  // TeleCRM LOGIN lead only for customers with a name/email on file
  // (docs/old-telecrm-integration.md).
  if (row.fullName || row.emailAddress) {
    queueCRMLead({ params: { userId: row.id }, leadType: CRM_LEAD_TYPE.LOGIN }, { traceId, customerId: row.id });
  }

  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    customer: profile as unknown as Record<string, unknown>,
    isNewUser,
  };
}

// Revoke the device's access token, deactivate DB tokens and clear the session key.
export async function logoutCustomer(customerId: string, traceId?: string): Promise<{
  ok: boolean;
  message: string;
}> {
  logger.info("logoutCustomer service invoked", { traceId, customerId });
  // Revokes the access token already on the device; deactivating DB rows alone
  // only blocks refresh. Fail-open if Redis is down (see libs/tokenRevocation.ts),
  // and called first so a later teardown failure still leaves the token revoked.
  await revokeAllTokensForUser("customer", String(customerId));

  const numId = Number(customerId);
  if (Number.isInteger(numId) && numId > 0) {
    await customerAuthRepository.deactivateTokens(numId);
    await customerAuthRepository.markLoggedOut(numId);
  }
  await redisClient.del(`customer_session:${customerId}`);
  logger.info("logoutCustomer service completed", { traceId, customerId });
  return { ok: true, message: "Logged out successfully." };
}

// Rotate the token pair (new row before retiring old); rethrows DB outages.
export async function refreshCustomerToken(refreshToken: string, traceId?: string) {
  logger.info("refreshCustomerToken service invoked", { traceId });
  if (!refreshToken) {
    logger.warn("refreshCustomerToken service missing token", { traceId });
    return { ok: false, message: "Refresh token is required." };
  }
  
  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
    const customerId = decoded.id;

    const numId = Number(customerId);
    if (!Number.isInteger(numId) || numId <= 0) {
      return { ok: false, message: "Invalid or revoked refresh token." };
    }
    const dbToken = await customerAuthRepository.findActiveTokenByRefresh(refreshToken, numId);
    if (!dbToken) {
      logger.warn("refreshCustomerToken service invalid token", { traceId, customerId });
      return { ok: false, message: "Invalid or revoked refresh token." };
    }
    const row = await customerAuthRepository.findLoginableById(numId);
    if (!row) {
      logger.warn("refreshCustomerToken service user not found", { traceId, customerId });
      return { ok: false, message: "User not found or disabled." };
    }

    const idStr = String(row.id);
    const newToken = jwt.sign(
      { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
      JWT_SECRET
    );
    const newRefreshToken = jwt.sign(
      { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
      JWT_REFRESH_SECRET
    );

    // Insert the new row BEFORE retiring the old one. `authenticate` rejects a
    // customer with no live token row, so the reverse order opens a window where a
    // concurrent request gets 401 SESSION_REVOKED and the app logs out. Both rows
    // being briefly live is benign (same customer); clients must never fire two
    // refreshes at once (docs/client/REFRESH_TOKEN_GUIDE.md).
    await customerAuthRepository.createToken({
      customerId: row.id,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });

    await customerAuthRepository.deactivateToken(dbToken.id);

    await redisClient.set(
      `customer_session:${idStr}`,
      newToken,
      "EX",
      JWT_REFRESH_TTL_DAYS * 24 * 60 * 60
    );

    const profile = toCustomerProfileDto(row, {
      isNewUser: !row.verified,
      isProfileCompleted: isProfileCompleteMysql(row),
    });
    logger.info("refreshCustomerToken service success", { traceId, customerId });
    return {
      ok: true,
      message: "Token refreshed successfully.",
      token: newToken,
      refreshToken: newRefreshToken,
      customer: profile,
    };
  } catch (err) {
    logger.error("refreshCustomerToken service error", { traceId, error: (err as Error).message, stack: (err as Error).stack });
    // A DB outage is not a verdict on the token: rethrow so the controller answers
    // 503 (client retries) instead of 401 (app logs out).
    if (isDatabaseUnavailableError(err)) throw err;
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}
