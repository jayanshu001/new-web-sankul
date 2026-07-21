import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadS3Mixed } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
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

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Category writes flush "material-category"; leaf-material writes flush "material".

// Categories
router.get("/categories", cacheRoute({ ttl: 86400, entity: "material-category" }), listCategories);
router.post("/categories", uploadS3.single("image"), autoFlushGroup("material-category"), createCategory);
router.post("/categories/reorder", autoFlushGroup("material-category"), reorderCategories);
router.get("/categories/:id", cacheRoute({ ttl: 86400, entity: "material-category" }), getCategoryById);
router.put("/categories/:id", uploadS3.single("image"), autoFlushGroup("material-category"), updateCategory);
router.delete("/categories/:id", autoFlushGroup("material-category"), deleteCategory);
router.patch("/categories/:id/status", autoFlushGroup("material-category"), toggleCategoryStatus);
router.post("/categories/:id/duplicate", autoFlushGroup("material-category"), duplicateCategory);
router.get("/categories/:id/courses", getCategoryCourses);
router.get("/categories/:id/materials", getCategoryMaterials);

// Leaf materials
router.get("/", cacheRoute({ ttl: 86400, entity: "material" }), listMaterials);
router.post("/", uploadS3Mixed.single("file"), autoFlushGroup("material"), createMaterial);
router.post("/reorder", autoFlushGroup("material"), reorderMaterials);
router.post("/bulk-status", autoFlushGroup("material"), bulkStatus);
router.post("/bulk-delete", autoFlushGroup("material"), bulkDelete);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "material" }), getMaterialById);
router.put("/:id", uploadS3Mixed.single("file"), autoFlushGroup("material"), updateMaterial);
router.delete("/:id", autoFlushGroup("material"), deleteMaterial);
router.patch("/:id/status", autoFlushGroup("material"), toggleMaterialStatus);

export default router;
