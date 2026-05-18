import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listPermissionCategories,
  getPermissionCategory,
  createPermissionCategory,
  updatePermissionCategory,
  deletePermissionCategory,
} from "./permissionCategory.controller";

const router = Router();

router.use(authenticate, requireRole("super_admin"));

router.get("/", listPermissionCategories);
router.post("/", createPermissionCategory);
router.get("/:id", getPermissionCategory);
router.put("/:id", updatePermissionCategory);
router.delete("/:id", deletePermissionCategory);

export default router;
