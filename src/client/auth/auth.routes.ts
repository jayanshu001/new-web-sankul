import { Router } from "express";
import { generateOtpHandler, validateOtpHandler, refreshTokenHandler, resendOtpHandler, logoutHandler } from "./auth.controller";
import authenticate from "../../middlewares/authenticate";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";
import { CustomerAccessToken } from "../../models/customer/CustomerAccessToken.model";
import { isMysqlModule } from "../../config/migration";
import { customerAuthRepository } from "../../modules/customer-auth/customer-auth.repository";
// TEMP (testing): otpLimiter disabled so repeated OTP requests don't hit the
// 15-min / 5-request 429. RESTORE before merging — re-add it to the two
// /otp routes below and uncomment this import.
// import { otpLimiter } from "../../config/rateLimiter";

const router = Router();

/**
 * @route  POST /api/v1/auth/otp/generate
 * @desc   Send OTP to phone number (creates account if first time)
 * @access Public
 */
router.post("/otp/generate", /* otpLimiter, */ generateOtpHandler); // TEMP: rate limit off for testing

/**
 * @route  POST /api/v1/auth/otp/resend
 * @desc   Resend an OTP to the user's phone number
 * @access Public
 */
router.post("/otp/resend", /* otpLimiter, */ resendOtpHandler); // TEMP: rate limit off for testing

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
      if (isMysqlModule("customer-auth")) {
        const numId = Number(customerId);
        if (Number.isInteger(numId) && numId > 0) {
          await customerAuthRepository.deactivateTokens(numId);
        }
        return;
      }
      await CustomerAccessToken.updateMany(
        { customerId, active: true },
        { active: false, deleted: true }
      );
    },
  })
);

export default router;
