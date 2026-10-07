// Admin roles: role and role-permission routes behind strict catalog RBAC.
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

// Authn + admin-surface gate come from admin.routes.ts. Catalog RBAC (`roles.*`)
// is hard-enforced here regardless of RBAC_ENFORCE because this router is itself
// the security boundary.
router.use(enforceRbacStrict);

router.get("/", listRoles);
router.post("/", createRole);
router.get("/:id", getRole);
router.put("/:id", updateRole);
router.delete("/:id", deleteRole);

router.get("/:id/permissions", getRolePermissions);
router.put("/:id/permissions", syncRolePermissions);

export default router;
