import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadS3Mixed } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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
  getCategoryLinkedProducts,
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
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.MaterialCategory }), listCategories);
router.post("/categories", uploadS3.single("image"), autoFlushGroup(CacheEntity.MaterialCategory), createCategory);
router.post("/categories/reorder", autoFlushGroup(CacheEntity.MaterialCategory), reorderCategories);
router.get("/categories/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.MaterialCategory }), getCategoryById);
router.put("/categories/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.MaterialCategory), updateCategory);
router.delete("/categories/:id", autoFlushGroup(CacheEntity.MaterialCategory), deleteCategory);
router.patch("/categories/:id/status", autoFlushGroup(CacheEntity.MaterialCategory), toggleCategoryStatus);
router.post("/categories/:id/duplicate", autoFlushGroup(CacheEntity.MaterialCategory), duplicateCategory);
router.get("/categories/:id/courses", getCategoryCourses);
router.get("/categories/:id/products", getCategoryLinkedProducts);
router.get("/categories/:id/materials", getCategoryMaterials);

// Leaf materials
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material }), listMaterials);
router.post("/", uploadS3Mixed.single("file"), autoFlushGroup(CacheEntity.Material), createMaterial);
router.post("/reorder", autoFlushGroup(CacheEntity.Material), reorderMaterials);
router.post("/bulk-status", autoFlushGroup(CacheEntity.Material), bulkStatus);
router.post("/bulk-delete", autoFlushGroup(CacheEntity.Material), bulkDelete);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material }), getMaterialById);
router.put("/:id", uploadS3Mixed.single("file"), autoFlushGroup(CacheEntity.Material), updateMaterial);
router.delete("/:id", autoFlushGroup(CacheEntity.Material), deleteMaterial);
router.patch("/:id/status", autoFlushGroup(CacheEntity.Material), toggleMaterialStatus);

export default router;
