import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
  changePasswordHandler,
} from "./promoter.auth.controller";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";
import { PromoterAccessToken } from "../../models/promoter/PromoterAccessToken.model";
import { isMysqlModule } from "../../config/migration";
import { promoterAuthRepository } from "../../modules/promoter-auth/promoter-auth.repository";

const router = Router();

router.post("/login", loginHandler);
router.post("/token/refresh", refreshHandler);

router.use(authenticate, requireRole("promoter"));

router.delete("/logout", logoutHandler);
router.post(
  "/logout-all-devices",
  logoutAllDevicesHandler({
    type: "promoter",
    extraTeardown: async (promoterId) => {
      // SQL bookkeeping cleanup (authoritative revocation is the Redis cutoff in
      // revokeAllTokensForUser); mirror the customer surface's dual-path.
      if (isMysqlModule("promoter-auth")) {
        const numId = Number(promoterId);
        if (Number.isInteger(numId) && numId > 0) await promoterAuthRepository.deactivateAllTokens(numId);
        return;
      }
      await PromoterAccessToken.updateMany(
        { promoterId, active: true },
        { active: false, deleted: true }
      );
    },
  })
);
router.get("/me", meHandler);
router.put("/me", uploadS3.single("image"), updateProfileHandler);
router.post("/change-password", changePasswordHandler);

export default router;
