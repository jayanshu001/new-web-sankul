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
} from "./educator.auth.controller";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";
import { educatorAuthRepository } from "../../modules/educator-auth/educator-auth.repository";

const router = Router();

router.post("/login", loginHandler);
router.post("/token/refresh", refreshHandler);

router.use(authenticate, requireRole("educator"));

router.delete("/logout", logoutHandler);
router.post(
  "/logout-all-devices",
  logoutAllDevicesHandler({
    type: "educator",
    extraTeardown: async (educatorId) => {
      // SQL bookkeeping cleanup (authoritative revocation is the Redis cutoff in
      // revokeAllTokensForUser).
      const numId = Number(educatorId);
      if (Number.isInteger(numId) && numId > 0) await educatorAuthRepository.deactivateAllTokens(numId);
    },
  })
);
router.get("/me", meHandler);
router.put("/me", uploadS3.single("image"), updateProfileHandler);
router.post("/change-password", changePasswordHandler);

export default router;
