import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  reorderCategories,
  getCategoryCourses,
  getCategoryMaterials,
  listMaterials,
  getMaterialById,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  toggleMaterialStatus,
  reorderMaterials,
  bulkStatus,
  bulkDelete,
} from "./material.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Categories
router.get("/categories", listCategories);
router.post("/categories", createCategory);
router.post("/categories/reorder", reorderCategories);
router.get("/categories/:id", getCategoryById);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);
router.patch("/categories/:id/status", toggleCategoryStatus);
router.get("/categories/:id/courses", getCategoryCourses);
router.get("/categories/:id/materials", getCategoryMaterials);

// Leaf materials
router.get("/", listMaterials);
router.post("/", createMaterial);
router.post("/reorder", reorderMaterials);
router.post("/bulk-status", bulkStatus);
router.post("/bulk-delete", bulkDelete);
router.get("/:id", getMaterialById);
router.put("/:id", updateMaterial);
router.delete("/:id", deleteMaterial);
router.patch("/:id/status", toggleMaterialStatus);

export default router;
