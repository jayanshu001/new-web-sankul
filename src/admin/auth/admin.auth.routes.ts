import { Router } from "express";
import {
  adminLoginHandler,
  adminRegisterHandler,
  adminChangePasswordHandler,
  adminRefreshHandler,
  adminLogoutHandler,
  adminUpdateProfileHandler,
} from "./admin.auth.controller";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { AdminUser } from "../../models/admin/AdminUser.model";
import { AdminAccessToken } from "../../models/admin/AdminAccessToken.model";
import { failure } from "../../utils/httpResponse";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";

const router = Router();

const bootstrapOrSuperAdminGuard = async (req: any, res: any, next: any) => {
  try {
    const adminCount = await AdminUser.countDocuments({
      role: { $in: ["super_admin", "admin", "editor"] },
      status: true,
    });

    // First admin bootstrap: allow registration without token.
    if (adminCount === 0) return next();

    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return failure(
        res,
        "Bootstrap completed. Login as existing super admin and pass Bearer token to register more admins.",
        401
      );
    }

    // After bootstrap: only authenticated super_admin can register admins.
    return authenticate(req, res, () => requireRole("super_admin")(req, res, next));
  } catch {
    return failure(res, "Unable to validate admin bootstrap state.", 500);
  }
};

/**
 * @route  POST /api/v1/admin/auth/login
 * @desc   Admin login with email + password → returns JWT
 * @access Public
 */
router.post("/login", adminLoginHandler);

/**
 * @route  POST /api/v1/admin/auth/register
 * @desc   Bootstrap first admin (public once) OR create admin by super_admin
 * @access Public for first admin only, protected afterwards
 */
router.post("/register", bootstrapOrSuperAdminGuard, adminRegisterHandler);

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
 * @route  POST /api/v1/admin/auth/logout-all-devices
 * @desc   Revoke every outstanding token for this admin. Useful after a
 *         password change, suspicious activity, or a "log out everywhere"
 *         action. See libs/tokenRevocation.ts for the cutoff semantics.
 * @access Protected
 */
router.post(
  "/logout-all-devices",
  authenticate,
  logoutAllDevicesHandler({
    type: "admin",
    extraTeardown: async (adminId) => {
      // Mark every stored access-token row inactive so refresh attempts also
      // fail at the DB layer, not just the Redis cutoff. Matches what the
      // existing logout endpoint does for a single device.
      await AdminAccessToken.updateMany(
        { adminUserId: adminId, active: true },
        { active: false, deleted: true }
      );
    },
  })
);

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
