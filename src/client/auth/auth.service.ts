import logger from "../../utils/logger";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { redisClient } from "../../config/redis";
import { customerAuthRepository } from "../../modules/customer-auth/customer-auth.repository";
import {
  toCustomerProfileDto,
  isProfileCompleteMysql,
} from "../../modules/customer-auth/customer-auth.transformer";

// ─── Constants ────────────────────────────────────────────────────────────────
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
// After OTP_MAX_ATTEMPTS wrong entries the account is OTP-blocked for this long;
// the otp-unblock scheduler auto-restores it once the block is older than this.
// Kept in sync with the scheduler via the same OTP_BLOCK_HOURS env (default 24).
const OTP_BLOCK_HOURS = Number(process.env.OTP_BLOCK_HOURS) || 24;
const LOGIN_MAX_ATTEMPTS = 20;
// Test numbers always get static OTP
const TESTING_ACCOUNTS: string[] = (process.env.TESTING_PHONE_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);
const STATIC_OTP = "5786";

// TEMPORARY: when DUMMY_OTP_ENABLED=true, EVERY signup/login gets a fixed dummy
// OTP and the real SMS provider is NOT called. Lets QA/dev sign up any number
// without burning SMS credits. Verify needs no change — it string-compares the
// entered OTP against the stored one, which is now the dummy. MUST stay off in
// production (defaults off; opt-in via env only).
const DUMMY_OTP_ENABLED = process.env.DUMMY_OTP_ENABLED === "true";
const DUMMY_OTP_VALUE = process.env.DUMMY_OTP_VALUE || "1234";
if (DUMMY_OTP_ENABLED) {
  logger.warn(
    `[AUTH] DUMMY_OTP_ENABLED is ON — all OTPs are "${DUMMY_OTP_VALUE}" and SMS is skipped. Do NOT use in production.`
  );
}

const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
const JWT_ACCESS_TTL_DAYS = 7;
const JWT_REFRESH_TTL_DAYS = 60;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function formatPhone(raw: string): string {
  // Keep last 10 digits
  return raw.replace(/\D/g, "").slice(-10);
}

async function sendOtpSms(phone: string, otp: string): Promise<boolean> {
  const base = process.env.TWO_FACTOR_BASE_URL;
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  if (!base || !apiKey) {
    console.warn("[SMS] 2Factor base url / api key not set — skipping send, OTP:", otp);
    return true; // dev fallback
  }
  // URL-ENCODE every interpolated segment. The 2Factor OTP template name can
  // contain spaces (e.g. "Websankul OTP"); an unencoded space makes the URL
  // malformed, so axios throws and the OTP silently fails to send.
  const template = encodeURIComponent(process.env.TWO_FACTOR_WEBSANKUL_OTP_TEMPLATE ?? "");
  const hash = encodeURIComponent(process.env.TWO_FACTOR_OTP_HASH_CODE ?? "");
  const url = `${base}${apiKey}/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(otp)}/${template}?var1=${hash}`;
  try {
    const { default: axios } = await import("axios");
    const resp = await axios.get(url, {
      params: {
        mobile: phone,
        otp,
        // extend with your SMS provider params via env
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

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Step 1 — Generate & send OTP.
 * Creates the customer record if it doesn't exist yet.
 */
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
    // No ACTIVE account for this phone → fresh signup (any soft-deleted history
    // for the same phone stays intact and untouched). The uq_customer_phone_active
    // index permits this because deleted rows expose NULL for phone_active.
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

/**
 * Step 1B — Resend OTP.
 * Generates a new OTP for an existing customer, bypassing the standard 5-minute
 * cooldown but enforcing a strict 60-second limit to prevent spam.
 */
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
  // 60-second strict cooldown using otp_expires_at.
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

/**
 * Step 2 — Validate OTP & return JWT.
 */
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

  // Constant-time OTP comparison to avoid a timing side-channel. (Length differs →
  // definitely wrong; OTP length is fixed so the length check leaks nothing useful.)
  const otpBuf = Buffer.from(String(row.otp ?? ""), "utf8");
  const inputBuf = Buffer.from(String(otp ?? ""), "utf8");
  const otpMismatch = otpBuf.length !== inputBuf.length || !crypto.timingSafeEqual(otpBuf, inputBuf);
  if (otpMismatch) {
    // On the OTP_MAX_ATTEMPTS-th wrong entry, block the account (status=false +
    // otpBlockedAt=now) instead of returning a zero/negative "attempts remaining".
    // findLoginableByPhone requires status=true, so once blocked every further
    // validate returns "Invalid user." until the 24h otp-unblock sweep restores it.
    if (triedOtp >= OTP_MAX_ATTEMPTS) {
      await customerAuthRepository.blockOtp(row.id, OTP_MAX_ATTEMPTS, osType);
      logger.warn("validateOtp service account blocked (too many wrong OTPs)", { traceId, customerId: row.id });
      return {
        ok: false,
        message: `Due to too many wrong attempts, your account has been blocked for ${OTP_BLOCK_HOURS} hours.`,
      };
    }
    await customerAuthRepository.bumpTriedOtp(row.id, triedOtp, osType);
    const remaining = OTP_MAX_ATTEMPTS - triedOtp; // always ≥ 1 here (block handled above)
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
    JWT_SECRET,
    { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
  );
  const refreshToken = jwt.sign(
    { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
    JWT_REFRESH_SECRET,
    { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
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
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  const profile = toCustomerProfileDto(row, { isNewUser, isProfileCompleted: profileCompleted });
  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    customer: profile as unknown as Record<string, unknown>,
    isNewUser,
  };
}

/**
 * Step 3 — Logout: invalidate all tokens.
 */
export async function logoutCustomer(customerId: string, traceId?: string): Promise<{
  ok: boolean;
  message: string;
}> {
  logger.info("logoutCustomer service invoked", { traceId, customerId });
  const numId = Number(customerId);
  if (Number.isInteger(numId) && numId > 0) {
    await customerAuthRepository.deactivateTokens(numId);
    await customerAuthRepository.markLoggedOut(numId);
  }
  await redisClient.del(`customer_session:${customerId}`);
  logger.info("logoutCustomer service completed", { traceId, customerId });
  return { ok: true, message: "Logged out successfully." };
}

/**
 * Step 4 — Refresh Token Logic.
 */
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

    await customerAuthRepository.deactivateToken(dbToken.id);

    const idStr = String(row.id);
    const newToken = jwt.sign(
      { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
      JWT_SECRET,
      { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
    );
    const newRefreshToken = jwt.sign(
      { id: idStr, phone: row.phoneNumber, role: "customer", type: "customer" },
      JWT_REFRESH_SECRET,
      { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
    );

    await customerAuthRepository.createToken({
      customerId: row.id,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });

    await redisClient.set(
      `customer_session:${idStr}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
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
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}
