import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
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

// Catalog is readable by both admin and super_admin (frontend caches it
// across the session for the Roles page tree).
// Catalog read is gated by the admin-router staff gate + catalog RBAC
// (permissions.view via enforceRbac); the super_admin floor below covers the
// permission-management routes.
router.get("/catalog", authenticate, getPermissionCatalog);

router.use(authenticate, requireRole("super_admin"));

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
