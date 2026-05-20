import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listPermissionCategories,
  getPermissionCategory,
  updatePermissionCategory,
  deletePermissionCategory,
} from "./permissionCategory.controller";

const router = Router();

router.use(authenticate, requireRole("super_admin"));

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
