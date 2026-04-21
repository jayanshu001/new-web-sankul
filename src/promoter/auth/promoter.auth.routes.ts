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

const router = Router();

router.post("/login", loginHandler);
router.post("/token/refresh", refreshHandler);

router.use(authenticate, requireRole("promoter"));

router.delete("/logout", logoutHandler);
router.get("/me", meHandler);
router.put("/me", uploadS3.single("image"), updateProfileHandler);
router.post("/change-password", changePasswordHandler);

export default router;
