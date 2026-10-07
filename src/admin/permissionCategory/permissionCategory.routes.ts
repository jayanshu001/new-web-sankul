// Admin permission categories: strict-RBAC routes (create is retired with 410).
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
// (`permission-categories.*`) is hard-enforced here regardless of RBAC_ENFORCE
// because this router is itself the security boundary.
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
