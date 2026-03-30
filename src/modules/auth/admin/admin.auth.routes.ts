import { Router } from "express";
import {
  adminLoginHandler,
  adminRegisterHandler,
  adminChangePasswordHandler,
} from "./admin.auth.controller";
import authenticate from "../../../middlewares/authenticate";

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

export default router;
