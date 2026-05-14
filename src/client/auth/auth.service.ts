import logger from "../../utils/logger";
import jwt from "jsonwebtoken";
import { Customer } from "../../models/customer/Customer.model";
import { CustomerOtp } from "../../models/customer/CustomerOtp.model";
import { CustomerAccessToken } from "../../models/customer/CustomerAccessToken.model";
import { redisClient } from "../../config/redis";

// ─── Constants ────────────────────────────────────────────────────────────────
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const LOGIN_MAX_ATTEMPTS = 20;
// Test numbers always get static OTP
const TESTING_ACCOUNTS: string[] = (process.env.TESTING_PHONE_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);
const STATIC_OTP = "5786";

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
  const url = `${process.env.TWO_FACTOR_BASE_URL}${process.env.TWO_FACTOR_API_KEY}/SMS/${phone}/${otp}/${process.env.TWO_FACTOR_WEBSANKUL_OTP_TEMPLATE}?var1=${process.env.TWO_FACTOR_OTP_HASH_CODE}`;
  if (!url) {
    console.warn("[SMS] SMS_API_URL not set — skipping send, OTP:", otp);
    return true; // dev fallback
  }
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

  // Find existing customer (active, not deleted)
  const existing = await Customer.findOne({
    phoneNumber: phone,
    isAccountDeleted: false,
  }).select("+otp otpExpiresAt triedOtp loginCount status");

  // Account checks for existing users
  if (existing) {
    // TEMPORARILY DISABLED — `loginCount` is incremented on every OTP request
    // and is NEVER reset on success, so this permanently locks out any account
    // after 20 lifetime logins (not a real brute-force guard). Re-enable once
    // loginCount is reset to 0 on successful OTP validation.
    // if ((existing.loginCount ?? 0) > LOGIN_MAX_ATTEMPTS) {
    //   logger.warn("generateOtp service login attempts exceeded", { traceId, phone });
    //   return { ok: false, message: "Account suspended due to login policy violations." };
    // }
    if (!existing.status) {
      logger.warn("generateOtp service account blocked", { traceId, phone });
      return { ok: false, message: "Your account has been blocked. Please contact support." };
    }
    // OTP cooldown — still within TTL
    if (existing.otp && existing.otpExpiresAt && existing.otpExpiresAt > new Date()) {
      return {
        ok: false,
        message: `Please wait ${OTP_TTL_MINUTES} minutes before requesting a new OTP.`,
      };
    }
  }

  const otp = isStatic ? STATIC_OTP : String(Math.floor(1000 + Math.random() * 8999));
  console.log(`\x1b[1m\x1b[38;5;50m[OTP]\x1b[0m \x1b[38;5;208mGenerated\x1b[0m → \x1b[1m\x1b[38;5;226m${otp}\x1b[0m`);

  // Send SMS (or skip for static test numbers)
  const sent = isStatic || (await sendOtpSms(phone, otp));
  if (!sent) {
    return { ok: false, message: "Unable to send OTP. Please try again later." };
  }

  const expiresAt = addMinutes(OTP_TTL_MINUTES);
  let isNewUser = false;

  if (existing) {
    // Update OTP on existing customer
    await Customer.updateOne(
      { _id: existing._id },
      {
        otp,
        otpExpiresAt: expiresAt,
        triedOtp: 0,
        otpBlockedAt: undefined,
        loginCount: (existing.loginCount ?? 0) + 1,
      }
    );
    logger.info("generateOtp service existing user OTP updated", { traceId, phone, customerId: existing._id });
  } else {
    // Create new stub customer
    isNewUser = true;
    try {
      const created = await Customer.create({
        phoneNumber: phone,
        isPhoneVerified: false,
        verified: false,
        otp,
        otpExpiresAt: expiresAt,
        triedOtp: 0,
        loginCount: 1,
        isAccountDeleted: false,
        status: true,
      });
      logger.info("generateOtp service new user created", { traceId, phone, customerId: created._id });
    } catch (err: any) {
      if (err?.code === 11000) {
        // Concurrent signup — phone already registered, treat as existing user
        logger.warn("generateOtp service duplicate phone race condition", { traceId, phone });
        return { ok: false, message: "Please wait before requesting a new OTP." };
      }
      throw err;
    }
  }

  // Log OTP in history
  const customer = await Customer.findOne({ phoneNumber: phone }).select("_id");
  if (customer) {
    await CustomerOtp.create({ customerId: customer._id, otp });
    logger.info("generateOtp service otp recorded", { traceId, customerId: customer._id });
  }

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

  const existing = await Customer.findOne({
    phoneNumber: phone,
    isAccountDeleted: false,
  }).select("+otp otpExpiresAt triedOtp loginCount status");

  if (!existing) {
    logger.warn("resendOtp service user not found", { traceId, phone });
    return { ok: false, message: "User not found. Please register first." };
  }

  // TEMPORARILY DISABLED — see the note in generateOtp: loginCount never resets,
  // so this permanently locks out accounts after 20 lifetime logins.
  // if ((existing.loginCount ?? 0) > LOGIN_MAX_ATTEMPTS) {
  //   return { ok: false, message: "Account suspended due to login policy violations." };
  // }

  if (!existing.status) {
    return { ok: false, message: "Your account has been blocked. Please contact support." };
  }

  // 60-second strict cooldown check
  if (existing.otpExpiresAt && existing.otpExpiresAt > new Date()) {
    const msUntilExpiry = existing.otpExpiresAt.getTime() - Date.now();
    const msSinceLastSend = (OTP_TTL_MINUTES * 60 * 1000) - msUntilExpiry;

    if (msSinceLastSend < 60000) {
      const waitSecs = Math.ceil((60000 - msSinceLastSend) / 1000);
      return { ok: false, message: `Please wait ${waitSecs} seconds before resending OTP.` };
    }
  }

  // Generate & Send
  const otp = isStatic ? STATIC_OTP : String(Math.floor(1000 + Math.random() * 8999));
  logger.info("resendOtp service otp generated", { traceId, phone, otpType: isStatic ? "static" : "dynamic" });

  const sent = isStatic || (await sendOtpSms(phone, otp));
  if (!sent) {
    return { ok: false, message: "Unable to resend OTP. Please try again later." };
  }

  // Update customer
  const expiresAt = addMinutes(OTP_TTL_MINUTES);
  await Customer.updateOne(
    { _id: existing._id },
    {
      otp,
      otpExpiresAt: expiresAt,
      triedOtp: 0,
      otpBlockedAt: undefined,
    }
  );

  await CustomerOtp.create({ customerId: existing._id, otp });
  logger.info("resendOtp service completed", { traceId, customerId: existing._id });

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

  const customer = await Customer.findOne({
    phoneNumber: phone,
    isAccountDeleted: false,
    status: true,
  }).select(
    "+otp otpExpiresAt triedOtp firstName middleName lastName emailAddress profilePicture phone2 dob gender stateId districtId city educationId language goals referralCode rewardPoints verified firebaseToken osType loginCount isLoggedIn"
  );

  if (!customer) {
    logger.warn("validateOtp service invalid user", { traceId, phone });
    return { ok: false, message: "Invalid user." };
  }

  const triedOtp = (customer.triedOtp ?? 0) + 1;

  // Too many attempts — block
  // if (triedOtp >= OTP_MAX_ATTEMPTS) {
  //   await Customer.updateOne(
  //     { _id: customer._id },
  //     { triedOtp, otpBlockedAt: new Date(), status: false }
  //   );
  //   logger.warn("validateOtp service otp attempts exceeded", { traceId, customerId: customer._id });
  //   return {
  //     ok: false,
  //     message: `Too many wrong attempts. Account blocked for 24 hours.`,
  //   };
  // }

  // Wrong OTP
  if (customer.otp !== otp) {
    await Customer.updateOne({ _id: customer._id }, { triedOtp, ...(osType ? { osType } : {}) });
    const remaining = OTP_MAX_ATTEMPTS - triedOtp;
    logger.warn("validateOtp service wrong otp", { traceId, customerId: customer._id, remaining });
    return {
      ok: false,
      message: `Invalid OTP. ${remaining} attempt(s) remaining.`,
    };
  }

  // Expired
  if (!customer.otpExpiresAt || customer.otpExpiresAt < new Date()) {
    logger.warn("validateOtp service otp expired", { traceId, customerId: customer._id });
    return { ok: false, message: "OTP has expired. Please request a new one." };
  }

  const isNewUser = !customer.verified;

  // Mark phone verified on first-time login
  if (!customer.isPhoneVerified || !customer.verified) {
    await Customer.updateOne(
      { _id: customer._id },
      { isPhoneVerified: true, verified: true, triedOtp: 0, ...(osType ? { osType } : {}) }
    );
  } else {
    await Customer.updateOne(
      { _id: customer._id },
      { triedOtp: 0, ...(osType ? { osType } : {}) }
    );
  }

  // Invalidate all previous tokens
  await CustomerAccessToken.updateMany(
    { customerId: customer._id },
    { active: false, deleted: true }
  );

  // Issue new JWT
  const token = jwt.sign(
    { id: customer._id.toString(), phone: customer.phoneNumber, role: "customer", type: "customer" },
    JWT_SECRET,
    { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
  );

  const refreshToken = jwt.sign(
    { id: customer._id.toString(), phone: customer.phoneNumber, role: "customer", type: "customer" },
    JWT_REFRESH_SECRET,
    { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
  );

  const expiresAt = addDays(JWT_REFRESH_TTL_DAYS);
  await CustomerAccessToken.create({
    customerId: customer._id,
    token,
    refreshToken,
    active: true,
    deleted: false,
    expiresAt,
  });

  // Save session to Redis for single-device enforcement
  await redisClient.set(
    `customer_session:${customer._id.toString()}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  // Shape response (omit sensitive fields)
  const profile = {
    id: customer._id,
    firstName: customer.firstName ?? "",
    middleName: customer.middleName ?? "",
    lastName: customer.lastName ?? "",
    phoneNumber: customer.phoneNumber,
    emailAddress: customer.emailAddress ?? "",
    profilePicture: customer.profilePicture ?? "",
    phone2: customer.phone2 ?? "",
    dob: customer.dob ?? "",
    gender: customer.gender ?? "",
    stateId: customer.stateId ?? "",
    districtId: customer.districtId ?? "",
    city: customer.city ?? "",
    educationId: customer.educationId ?? "",
    language: customer.language ?? "",
    goals: customer.goals ?? [],
    referralCode: customer.referralCode ?? "",
    rewardPoints: customer.rewardPoints ?? 0,
    osType: customer.osType,
    isNewUser,
  };

  return { ok: true, message: "Login successful.", token, refreshToken, customer: profile, isNewUser };
}

/**
 * Step 3 — Logout: invalidate all tokens.
 */
export async function logoutCustomer(customerId: string, traceId?: string): Promise<{
  ok: boolean;
  message: string;
}> {
  logger.info("logoutCustomer service invoked", { traceId, customerId });
  await CustomerAccessToken.updateMany(
    { customerId },
    { active: false, deleted: true }
  );
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

    const dbToken = await CustomerAccessToken.findOne({
      refreshToken,
      customerId,
      active: true,
      deleted: false,
    });

    if (!dbToken) {
      logger.warn("refreshCustomerToken service invalid token", { traceId, customerId });
      return { ok: false, message: "Invalid or revoked refresh token." };
    }

    const customer = await Customer.findOne({ _id: customerId, isAccountDeleted: false, status: true }).select(
      "+otp otpExpiresAt triedOtp firstName middleName lastName emailAddress profilePicture phone2 dob gender stateId districtId city educationId language goals referralCode rewardPoints verified firebaseToken osType loginCount isLoggedIn"
    );

    if (!customer) {
      logger.warn("refreshCustomerToken service user not found", { traceId, customerId });
      return { ok: false, message: "User not found or disabled." };
    }

    // Invalidate old token pair
    await CustomerAccessToken.updateOne({ _id: dbToken._id }, { active: false, deleted: true });

    // Issue new pair
    const newToken = jwt.sign(
      { id: customer._id.toString(), phone: customer.phoneNumber, role: "customer", type: "customer" },
      JWT_SECRET,
      { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
    );

    const newRefreshToken = jwt.sign(
      { id: customer._id.toString(), phone: customer.phoneNumber, role: "customer", type: "customer" },
      JWT_REFRESH_SECRET,
      { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
    );

    const expiresAt = addDays(JWT_REFRESH_TTL_DAYS);
    await CustomerAccessToken.create({
      customerId: customer._id,
      token: newToken,
      refreshToken: newRefreshToken,
      active: true,
      deleted: false,
      expiresAt,
    });

    // Update Redis
    await redisClient.set(
      `customer_session:${customer._id.toString()}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    const profile = {
      id: customer._id,
      firstName: customer.firstName ?? "",
      middleName: customer.middleName ?? "",
      lastName: customer.lastName ?? "",
      phoneNumber: customer.phoneNumber,
      emailAddress: customer.emailAddress ?? "",
      profilePicture: customer.profilePicture ?? "",
      phone2: customer.phone2 ?? "",
      dob: customer.dob ?? "",
      gender: customer.gender ?? "",
      stateId: customer.stateId ?? "",
      districtId: customer.districtId ?? "",
      city: customer.city ?? "",
      educationId: customer.educationId ?? "",
      language: customer.language ?? "",
      goals: customer.goals ?? [],
      referralCode: customer.referralCode ?? "",
      rewardPoints: customer.rewardPoints ?? 0,
      osType: customer.osType,
      isNewUser: !customer.verified,
    };

    logger.info("refreshCustomerToken service success", { traceId, customerId });
    return { ok: true, message: "Token refreshed successfully.", token: newToken, refreshToken: newRefreshToken, customer: profile };
  } catch (err) {
    logger.error("refreshCustomerToken service error", { traceId, error: (err as Error).message, stack: (err as Error).stack });
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}
