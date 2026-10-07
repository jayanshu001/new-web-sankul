// Admin auth: login, bootstrap register, refresh, logout and profile routes.
import { Router } from "express";
import {
  adminLoginHandler,
  adminRegisterHandler,
  adminChangePasswordHandler,
  adminRefreshHandler,
  adminLogoutHandler,
  adminUpdateProfileHandler,
  adminMeHandler,
} from "./admin.auth.controller";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import { adminAuthRepository } from "../../modules/admin-auth/admin-auth.repository";
import { failure } from "../../utils/httpResponse";
import { logoutAllDevicesHandler } from "../../middlewares/logoutAllDevices";

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
    // ws_users has no role/deleted column (roles live in spatie pivots, deleted
    // admins are status=inactive), so bootstrap counts active admins.
    const adminCount = await adminAuthRepository.countAdmins({ status: true });

    if (adminCount === 0) return next();

    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return failure(
        res,
        "Bootstrap completed. Login as existing super admin and pass Bearer token to register more admins.",
        401
      );
    }

    return authenticate(req, res, () => requireRole("super_admin")(req, res, next));
  } catch {
    return failure(res, "Unable to validate admin bootstrap state.", 500);
  }
};

// Public.
router.post("/login", adminLoginHandler);

// Public only while no active admin exists; super_admin afterwards.
router.post("/register", bootstrapOrSuperAdminGuard, adminRegisterHandler);

// The panel calls this on navigation to pick up permission changes without a token refresh.
router.get("/me", authenticate, adminMeHandler);

router.post("/change-password", authenticate, adminChangePasswordHandler);

// Public.
router.post("/refresh", adminRefreshHandler);

// Invalidates all devices.
router.delete("/logout", authenticate, adminLogoutHandler);

// Cutoff semantics: libs/tokenRevocation.ts.
router.post(
  "/logout-all-devices",
  authenticate,
  logoutAllDevicesHandler({
    type: "admin",
    extraTeardown: async (adminId) => {
      // Deactivate stored token rows so refresh also fails at the DB layer,
      // not just the Redis cutoff.
      const id = parseAdminBigId(String(adminId));
      if (id) await adminAuthRepository.deactivateAllTokens(id);
    },
  })
);

router.put
(
  "/profile",
  authenticate,
  uploadTo(UPLOAD_FOLDERS.users), uploadS3.single("image"),
  adminUpdateProfileHandler
);

export default router;
