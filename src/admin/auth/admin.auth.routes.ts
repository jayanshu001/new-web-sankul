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
import { adminAuthRepository } from "../../modules/admin-auth/admin-auth.repository";
import { failure } from "../../utils/httpResponse";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";

/** Parse a route/JWT admin id ("52") to bigint; null if not a valid positive id. */
const parseAdminBigId = (id: string): bigint | null => {
  try {
    const n = BigInt(id);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
};

const router = Router();

const bootstrapOrSuperAdminGuard = async (req: any, res: any, next: any) => {
  try {
    // ws_users has no `role`/`deleted` column (roles live in spatie pivots and
    // "deleted" admins are simply status=inactive), so bootstrap detection counts
    // active administrators.
    const adminCount = await adminAuthRepository.countAdmins({ status: true });

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
      const id = parseAdminBigId(String(adminId));
      if (id) await adminAuthRepository.deactivateAllTokens(id);
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
