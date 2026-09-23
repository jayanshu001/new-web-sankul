import { Router } from "express";
import { enforceRbacStrict } from "../../middlewares/rbacEnforce";
import {
  listPermissions,
  getPermission,
  updatePermission,
  deletePermission,
  getRolesForPermission,
  getPermissionsTree,
} from "./permission.controller";
import { getPermissionCatalog } from "./catalog.controller";

const router = Router();

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC
// (`permissions.*` in rbacRouteMap) is HARD-enforced here regardless of
// RBAC_ENFORCE — this router is the security boundary itself. Replaced the old
// requireRole("super_admin") floor 2026-09-11, which 403'd admins holding the
// permission before RBAC ran.
router.use(enforceRbacStrict);

router.get("/catalog", getPermissionCatalog);

router.get("/tree", getPermissionsTree);

router.get("/", listPermissions);
router.post("/", (_req, res) =>
  res.status(410).json({
    success: false,
    message:
      "Permissions are now defined in the catalog registry (code) and cannot be created via API. See GET /api/v1/admin/permissions/catalog.",
  })
);
router.get("/:id", getPermission);
router.put("/:id", updatePermission);
router.delete("/:id", deletePermission);
router.get("/:id/roles", getRolesForPermission);

export default router;
