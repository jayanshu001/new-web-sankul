// Client auth: OTP login, token refresh, guest session and logout routes.
import { Router } from "express";
import { generateOtpHandler, validateOtpHandler, refreshTokenHandler, resendOtpHandler, logoutHandler, accountStatusHandler, createGuestSessionHandler } from "./auth.controller";
import authenticate from "../../middlewares/authenticate";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";
import { customerAuthRepository } from "../../modules/customer-auth/customer-auth.repository";
import { otpLimiter } from "../../config/rateLimiter";

const router = Router();

// Static guest token, only while Firebase `maintain.env === "staging"`. See docs/client/GUEST_BROWSE.md.
router.post("/guest", createGuestSessionHandler);

// Public auth routes; mounted before the client router's master `authenticate`.
router.post("/otp/generate", otpLimiter, generateOtpHandler);

router.post("/otp/resend", otpLimiter, resendOtpHandler);

router.post("/otp/validate", validateOtpHandler);

router.post("/token/refresh", refreshTokenHandler);

// Disabled/deleted accounts are rejected by `authenticate` first with 401 + data.reason so the app logs out.
router.get("/account-status", authenticate, accountStatusHandler);

router.delete("/logout", authenticate, logoutHandler);

// Revokes every outstanding token for this customer. See libs/tokenRevocation.ts.
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
