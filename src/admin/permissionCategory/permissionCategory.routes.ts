import { Router } from "express";
import { enforceRbacStrict } from "../../middlewares/rbacEnforce";
import {
  listPermissionCategories,
  getPermissionCategory,
  updatePermissionCategory,
  deletePermissionCategory,
} from "./permissionCategory.controller";

const router = Router();

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC
// (`permission-categories.*` in rbacRouteMap) is HARD-enforced here regardless
// of RBAC_ENFORCE — this router is the security boundary itself. Replaced the
// old requireRole("super_admin") floor 2026-09-11.
router.use(enforceRbacStrict);

router.get("/", listPermissionCategories);
router.post("/", (_req, res) =>
  res.status(410).json({
    success: false,
    message:
      "Permission categories are derived from the catalog registry (code) and cannot be created via API. See GET /api/v1/admin/permissions/catalog.",
  })
);
router.get("/:id", getPermissionCategory);
router.put("/:id", updatePermissionCategory);
router.delete("/:id", deletePermissionCategory);

export default router;
