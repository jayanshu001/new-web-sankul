// Client profile: profile, dashboard, picture, device-token and account routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  updateProfileHandler,
  getProfileHandler,
  upsertProfilePictureHandler,
  deleteProfilePictureHandler,
  deleteAccountHandler,
  updateFirebaseTokenHandler,
  registerDeviceTokenHandler,
  unregisterDeviceTokenHandler,
} from "./customer.controller";
import { getProfileDashboardCounts } from "./dashboard.controller";

const router = Router();

router.put("/update", authenticate, updateProfileHandler);

router.get("/", authenticate, getProfileHandler);

router.get("/dashboard", authenticate, getProfileDashboardCounts);

router.put(
  "/profile-picture",
  authenticate,
  uploadTo(UPLOAD_FOLDERS.customers), uploadS3.single("image"),
  upsertProfilePictureHandler
);

router.delete("/profile-picture", authenticate, deleteProfilePictureHandler);

// The token is bound to the authenticated user, never a phone number from the body.
router.patch("/firebase-token", authenticate, updateFirebaseTokenHandler);

router.put("/device-token", authenticate, registerDeviceTokenHandler);

router.delete("/device-token", authenticate, unregisterDeviceTokenHandler);

router.delete("/", authenticate, deleteAccountHandler);

export default router;
