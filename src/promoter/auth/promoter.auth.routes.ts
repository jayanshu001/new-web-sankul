import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
  changePasswordHandler,
} from "./promoter.auth.controller";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";
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
      // revokeAllTokensForUser).
      const numId = Number(promoterId);
      if (Number.isInteger(numId) && numId > 0) await promoterAuthRepository.deactivateAllTokens(numId);
    },
  })
);
router.get("/me", meHandler);
router.put("/me", uploadTo(UPLOAD_FOLDERS.promoters), uploadS3.single("image"), updateProfileHandler);
router.post("/change-password", changePasswordHandler);

export default router;
