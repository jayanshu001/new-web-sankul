import { Request, Response } from "express";
import { generateOtp, validateOtp, refreshCustomerToken, resendOtp } from "./auth.service";
import { success, failure, getErrorMessage } from "../../../utils/httpResponse";

/**
 * POST /api/v1/auth/otp/generate
 * Body: { phoneNumber: string }
 */
export const generateOtpHandler = async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      return failure(res, "Phone number is required.", 422);
    } 

    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 10) {
      return failure(res, "Enter a valid 10-digit phone number.", 422);
    }

    const result = await generateOtp(phoneNumber);

    if (!result.ok) {
      return failure(res, result.message, 400);
    }

    return success(res, { isNewUser: result.isNewUser }, result.message, 200);
  } catch (err) {
    console.error("[generateOtpHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/auth/otp/validate
 * Body: { phoneNumber: string; otp: string; os_type?: "android" | "ios" }
 */
export const validateOtpHandler = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, otp, os_type } = req.body;

    if (!phoneNumber || !otp) {
      return failure(res, "Phone number and OTP are required.", 422);
    }

    const result = await validateOtp(
      String(phoneNumber),
      String(otp),
      os_type ? String(os_type) : undefined
    );

    if (!result.ok) {
      return failure(res, result.message, 400);
    }

    return success(
      res,
      { user: result.customer, accessToken: result.token, refreshToken: result.refreshToken, isNewUser: result.isNewUser },
      result.message,
      200
    );
  } catch (err) {
    console.error("[validateOtpHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/auth/otp/refresh
 * Body: { refreshToken: string }
 */
export const refreshTokenHandler = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return failure(res, "Refresh token is required.", 422);
    }

    const result = await refreshCustomerToken(String(refreshToken));

    if (!result.ok) {
      return failure(res, result.message, 401);
    }

    return success(
      res,
      { user: result.customer, accessToken: result.token, refreshToken: result.refreshToken, isNewUser: false },
      result.message,
      200
    );
  } catch (err) {
    console.error("[refreshTokenHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/auth/otp/resend
 * Body: { phoneNumber: string }
 */
export const resendOtpHandler = async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      return failure(res, "Phone number is required.", 422);
    }

    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 10) {
      return failure(res, "Enter a valid 10-digit phone number.", 422);
    }

    const result = await resendOtp(phoneNumber);

    if (!result.ok) {
      return failure(res, result.message, 400); // 400 for logic failure (like rate limits)
    }

    return success(res, {}, result.message, 200);
  } catch (err) {
    console.error("[resendOtpHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};
