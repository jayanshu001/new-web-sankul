import { Router } from "express";
import { generateOtpHandler, validateOtpHandler, refreshTokenHandler, resendOtpHandler, logoutHandler, accountStatusHandler } from "./auth.controller";
import authenticate from "../../middlewares/authenticate";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";
import { customerAuthRepository } from "../../modules/customer-auth/customer-auth.repository";
import { otpLimiter } from "../../config/rateLimiter";

const router = Router();

/**
 * @route  POST /api/v1/auth/otp/generate
 * @desc   Send OTP to phone number (creates account if first time)
 * @access Public
 */
router.post("/otp/generate", otpLimiter, generateOtpHandler);

/**
 * @route  POST /api/v1/auth/otp/resend
 * @desc   Resend an OTP to the user's phone number
 * @access Public
 */
router.post("/otp/resend", otpLimiter, resendOtpHandler);

/**
 * @route  POST /api/v1/auth/otp/validate
 * @desc   Validate OTP → returns JWT access token + user profile
 * @access Public
 */
router.post("/otp/validate", validateOtpHandler);

/**
 * @route  POST /api/v1/auth/otp/refresh
 * @desc   Refresh an expired access token using a valid refresh token.
 * @access Public
 */
router.post("/token/refresh", refreshTokenHandler);

/**
 * @route  GET /api/v1/client/auth/account-status
 * @desc   Lightweight gate probe for the app's Home Screen. Returns
 *         { active: true } when the account is healthy. A disabled or
 *         soft-deleted account is rejected by `authenticate` first with
 *         401 + data.reason (ACCOUNT_DISABLED / ACCOUNT_DELETED) → frontend
 *         logs out and shows the message.
 * @access Private (Customer)
 */
router.get("/account-status", authenticate, accountStatusHandler);

/**
 * @route  DELETE /api/v1/client/auth/logout
 * @desc   Invalidate all tokens and clear session
 * @access Private (Customer)
 */
router.delete("/logout", authenticate, logoutHandler);

/**
 * @route  POST /api/v1/client/auth/logout-all-devices
 * @desc   Revoke every outstanding token for this customer (e.g. after a
 *         suspected compromise). See libs/tokenRevocation.ts.
 * @access Private (Customer)
 */
router.post(
  "/logout-all-devices",
  authenticate,
  logoutAllDevicesHandler({
    type: "customer",
    extraTeardown: async (customerId) => {
      const numId = Number(customerId);
      if (Number.isInteger(numId) && numId > 0) {
        await customerAuthRepository.deactivateTokens(numId);
        await customerAuthRepository.markLoggedOut(numId);
      }
    },
  })
);

export default router;
