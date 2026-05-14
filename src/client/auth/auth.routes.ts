import { Router } from "express";
import { generateOtpHandler, validateOtpHandler, refreshTokenHandler, resendOtpHandler, logoutHandler } from "./auth.controller";
import authenticate from "../../middlewares/authenticate";
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

export default router;
