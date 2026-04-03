import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  updateProfileHandler,
  getProfileHandler,
  upsertProfilePictureHandler,
  deleteProfilePictureHandler,
} from "./customer.controller";

const router = Router();

/**
 * @route  PUT /api/v1/customer/profile
 * @desc   Update customer profile details
 * @access Private (Customer)
 */
router.put("/update", authenticate, updateProfileHandler);

/**
 * @route  GET /api/v1/client/profile/me
 * @desc   Get full customer profile data natively mapped to UI state
 */
router.get("/", authenticate, getProfileHandler);

/**
 * @route  PUT /api/v1/client/profile/profile-picture
 * @desc   Add or update customer profile picture
 * @access Private (Customer)
 * @body   multipart/form-data { image: file }
 */
router.put(
  "/profile-picture",
  authenticate,
  uploadS3.single("image"),
  upsertProfilePictureHandler
);

/**
 * @route  DELETE /api/v1/client/profile/profile-picture
 * @desc   Remove customer profile picture
 * @access Private (Customer)
 */
router.delete("/profile-picture", authenticate, deleteProfilePictureHandler);

export default router;
