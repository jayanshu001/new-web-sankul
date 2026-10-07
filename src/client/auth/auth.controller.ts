// Client auth: HTTP handlers for OTP login, refresh, logout and guest session.
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { generateOtp, validateOtp, refreshCustomerToken, resendOtp, logoutCustomer } from "./auth.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { isDatabaseUnavailableError, sendServiceUnavailable } from "../../utils/dbAvailability";
import { guestToken, isGuestModeOn } from "../../libs/guestSession";

// Returns the static guest token while guest mode is on (Firebase `maintain.env === "staging"`).
export const createGuestSessionHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createGuestSessionHandler invoked", { traceId, path: req.originalUrl });
  try {
    if (!(await isGuestModeOn())) {
      return failure(res, "Guest login is not available.", 403, {}, { reason: "GUEST_MODE_DISABLED" });
    }
    return success(res, { userType: "GUEST", accessToken: guestToken(), expiresAt: null }, "Guest session created.", 200);
  } catch (err) {
    logger.error("createGuestSessionHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const generateOtpHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("generateOtpHandler invoked", { traceId, path: req.originalUrl });
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      logger.warn("generateOtpHandler missing phone", { traceId });
      return failure(res, "Phone number is required.", 422);
    } 

    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 10) {
      logger.warn("generateOtpHandler invalid phone", { traceId, phoneNumber });
      return failure(res, "Enter a valid 10-digit phone number.", 422);
    }

    const result = await generateOtp(phoneNumber, traceId);

    if (!result.ok) {
      logger.warn("generateOtpHandler failed", { traceId, message: result.message });
      return failure(res, result.message, 400);
    }

    logger.info("generateOtpHandler success", { traceId, isNewUser: result.isNewUser });
    return success(res, { isNewUser: result.isNewUser }, result.message, 200);
  } catch (err) {
    logger.error("generateOtpHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const validateOtpHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("validateOtpHandler invoked", { traceId, path: req.originalUrl });
  try {
    const { phoneNumber, otp, os_type } = req.body;

    if (!phoneNumber || !otp) {
      logger.warn("validateOtpHandler missing fields", { traceId, hasPhone: !!phoneNumber, hasOtp: !!otp });
      return failure(res, "Phone number and OTP are required.", 422);
    }

    const result = await validateOtp(
      String(phoneNumber),
      String(otp),
      os_type ? String(os_type) : undefined,
      traceId
    );

    if (!result.ok) {
      logger.warn("validateOtpHandler failed", { traceId, message: result.message });
      return failure(res, result.message, 400);
    }

    logger.info("validateOtpHandler success", { traceId, isNewUser: result.isNewUser });
    return success(
      res,
      { user: result.customer, accessToken: result.token, refreshToken: result.refreshToken, isNewUser: result.isNewUser },
      result.message,
      200
    );
  } catch (err) {
    logger.error("validateOtpHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// Rotate the token pair; 503 (not 401) on DB outage so the app keeps the session.
export const refreshTokenHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("refreshTokenHandler invoked", { traceId, path: req.originalUrl });
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      logger.warn("refreshTokenHandler missing token", { traceId });
      return failure(res, "Refresh token is required.", 422);
    }

    const result = await refreshCustomerToken(String(refreshToken), traceId);

    if (!result.ok) {
      logger.warn("refreshTokenHandler failed", { traceId, message: result.message });
      return failure(res, result.message, 401);
    }

    logger.info("refreshTokenHandler success", { traceId });
    return success(
      res,
      { user: result.customer, accessToken: result.token, refreshToken: result.refreshToken, isNewUser: false },
      result.message,
      200
    );
  } catch (err) {
    logger.error("refreshTokenHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    // 503 (not 401/500) when the DB is unreachable: the refresh token is presumed fine,
    // so the client keeps the session and retries (docs/client/SERVICE_UNAVAILABLE_503.md).
    if (isDatabaseUnavailableError(err)) return sendServiceUnavailable(res);
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const logoutHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("logoutHandler invoked", { traceId, userId });
  try {
    if (!userId) {
      logger.warn("logoutHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }
    const result = await logoutCustomer(userId, traceId);
    logger.info("logoutHandler success", { traceId, userId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("logoutHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// `authenticate` already rejects disabled/deleted accounts with 401 + `data.reason`,
// so reaching here means the account is active.
export const accountStatusHandler = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return failure(res, "Unauthorized request.", 401, {}, { reason: "UNAUTHORIZED" });
  }
  return success(res, { active: true }, "Account is active.", 200);
};

export const resendOtpHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("resendOtpHandler invoked", { traceId, path: req.originalUrl });
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      logger.warn("resendOtpHandler missing phone", { traceId });
      return failure(res, "Phone number is required.", 422);
    }

    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 10) {
      logger.warn("resendOtpHandler invalid phone", { traceId, phoneNumber });
      return failure(res, "Enter a valid 10-digit phone number.", 422);
    }

    const result = await resendOtp(phoneNumber, traceId);

    if (!result.ok) {
      logger.warn("resendOtpHandler failed", { traceId, message: result.message });
      return failure(res, result.message, 400); // 400 for logic failure (like rate limits)
    }

    logger.info("resendOtpHandler success", { traceId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("resendOtpHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
