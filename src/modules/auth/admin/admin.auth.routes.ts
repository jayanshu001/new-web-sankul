import { Router } from "express";
import {
  adminLoginHandler,
  adminRegisterHandler,
  adminChangePasswordHandler,
  adminRefreshHandler,
  adminLogoutHandler,
  adminUpdateProfileHandler,
} from "./admin.auth.controller";
import authenticate from "../../../middlewares/authenticate";
import { uploadS3 } from "../../../middlewares/upload";

const router = Router();

/**
 * @route  POST /api/v1/admin/auth/login
 * @desc   Admin login with email + password → returns JWT
 * @access Public
 */
router.post("/login", adminLoginHandler);

/**
 * @route  POST /api/v1/admin/auth/register
 * @desc   Create a new admin user (super_admin only in production)
 * @access Protected (authenticate + role check)
 */
router.post("/register", authenticate, adminRegisterHandler);

/**
 * @route  POST /api/v1/admin/auth/change-password
 * @desc   Change logged-in admin's password
 * @access Protected
 */
router.post("/change-password", authenticate, adminChangePasswordHandler);

/**
 * @route  POST /api/v1/admin/auth/refresh
 * @desc   Refresh admin access tokens
 * @access Public
 */
router.post("/refresh", adminRefreshHandler);

/**
 * @route  DELETE /api/v1/admin/auth/logout
 * @desc   Logout admin entirely (invalidates all devices)
 * @access Protected
 */
router.delete("/logout", authenticate, adminLogoutHandler);

/**
 * @route  PUT /api/v1/admin/auth/profile
 * @desc   Update super admin profile (including Cloud Image upload)
 * @access Protected
 */
router.put(
  "/profile",
  authenticate,
  uploadS3.single("image"),
  adminUpdateProfileHandler
);

export default router;
