import { Router } from "express";
import { enforceRbacStrict } from "../../middlewares/rbacEnforce";
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  syncRolePermissions,
} from "./role.controller";

const router = Router();

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC (`roles.*`
// in rbacRouteMap) is HARD-enforced here regardless of RBAC_ENFORCE — this
// router is the security boundary itself. Replaced the old
// requireRole("super_admin") floor 2026-09-11.
router.use(enforceRbacStrict);

router.get("/", listRoles);
router.post("/", createRole);
router.get("/:id", getRole);
router.put("/:id", updateRole);
router.delete("/:id", deleteRole);

router.get("/:id/permissions", getRolePermissions);
router.put("/:id/permissions", syncRolePermissions);

export default router;
