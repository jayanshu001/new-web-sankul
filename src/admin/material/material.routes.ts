import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadS3Mixed } from "../../middlewares/upload";
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  reorderCategories,
  duplicateCategory,
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
router.post("/categories", uploadS3.single("image"), createCategory);
router.post("/categories/reorder", reorderCategories);
router.get("/categories/:id", getCategoryById);
router.put("/categories/:id", uploadS3.single("image"), updateCategory);
router.delete("/categories/:id", deleteCategory);
router.patch("/categories/:id/status", toggleCategoryStatus);
router.post("/categories/:id/duplicate", duplicateCategory);
router.get("/categories/:id/courses", getCategoryCourses);
router.get("/categories/:id/materials", getCategoryMaterials);

// Leaf materials
router.get("/", listMaterials);
router.post("/", uploadS3Mixed.single("file"), createMaterial);
router.post("/reorder", reorderMaterials);
router.post("/bulk-status", bulkStatus);
router.post("/bulk-delete", bulkDelete);
router.get("/:id", getMaterialById);
router.put("/:id", uploadS3Mixed.single("file"), updateMaterial);
router.delete("/:id", deleteMaterial);
router.patch("/:id/status", toggleMaterialStatus);

export default router;
