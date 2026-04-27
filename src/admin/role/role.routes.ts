import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
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

router.use(authenticate, requireRole("super_admin"));

router.get("/", listRoles);
router.post("/", createRole);
router.get("/:id", getRole);
router.put("/:id", updateRole);
router.delete("/:id", deleteRole);

router.get("/:id/permissions", getRolePermissions);
router.put("/:id/permissions", syncRolePermissions);

export default router;
