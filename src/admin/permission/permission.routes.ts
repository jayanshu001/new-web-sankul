import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listPermissions,
  getPermission,
  createPermission,
  updatePermission,
  deletePermission,
  getRolesForPermission,
  getPermissionsTree,
} from "./permission.controller";

const router = Router();

router.use(authenticate, requireRole("super_admin"));

router.get("/tree", getPermissionsTree);

router.get("/", listPermissions);
router.post("/", createPermission);
router.get("/:id", getPermission);
router.put("/:id", updatePermission);
router.delete("/:id", deletePermission);
router.get("/:id/roles", getRolesForPermission);

export default router;
