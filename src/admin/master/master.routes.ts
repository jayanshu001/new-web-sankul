import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  getEducators, getEducatorById, createEducator, updateEducator, deleteEducator, getEducatorDetails,
  getEducatorCourses, getEducatorLiveCourses, getEducatorPackages,
  getEducatorVideoCategories, getEducatorLiveSessions,
} from "./educator.controller";
import { getSubjectCategories, getSubjectCategoryById, createSubjectCategory, updateSubjectCategory, deleteSubjectCategory } from "./subjectCategory.controller";
import { getMaterials, createMaterial, updateMaterial, deleteMaterial } from "./material.controller";
import { getVideoCategories, getVideoCategoryById, createVideoCategory, updateVideoCategory, deleteVideoCategory } from "./videoCategory.controller";
import { getPackageCategories, createPackageCategory, updatePackageCategory, deletePackageCategory } from "./packageCategory.controller";

const router = Router();

// All master data endpoints are admin-only.
router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Each master tags its entity; the relational drill-down GETs (/:id/courses etc.)
// stay uncached. Writes flush the entity + the client caches embedding it.

// Educator Master
router.get("/educators", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Educator }), getEducators);
router.get("/educators/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Educator }), getEducatorById);
router.get("/educators/:id/details", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Educator }), getEducatorDetails);
router.get("/educators/:id/courses", getEducatorCourses);
router.get("/educators/:id/live-courses", getEducatorLiveCourses);
router.get("/educators/:id/video-categories", getEducatorVideoCategories);
router.get("/educators/:id/live-sessions", getEducatorLiveSessions);
router.get("/educators/:id/packages", getEducatorPackages);
router.post("/educators", uploadS3.single("image"), autoFlushGroup(CacheEntity.Educator), createEducator);
router.put("/educators/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.Educator), updateEducator);
router.delete("/educators/:id", autoFlushGroup(CacheEntity.Educator), deleteEducator);

// Subject Category Master
router.get("/subject-categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CourseSubjectCategory }), getSubjectCategories);
router.get("/subject-categories/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CourseSubjectCategory }), getSubjectCategoryById);
router.post("/subject-categories", uploadS3.single("image"), autoFlushGroup(CacheEntity.CourseSubjectCategory), createSubjectCategory);
router.put("/subject-categories/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.CourseSubjectCategory), updateSubjectCategory);
router.delete("/subject-categories/:id", autoFlushGroup(CacheEntity.CourseSubjectCategory), deleteSubjectCategory);

// Material Master
router.get("/materials", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material }), getMaterials);
router.post("/materials", uploadS3.single("image"), autoFlushGroup(CacheEntity.Material), createMaterial);
router.put("/materials/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.Material), updateMaterial);
router.delete("/materials/:id", autoFlushGroup(CacheEntity.Material), deleteMaterial);

// Video Category Master
router.get("/video-categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.VideoCategory }), getVideoCategories);
router.get("/video-categories/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.VideoCategory }), getVideoCategoryById);
router.post("/video-categories", uploadS3.single("image"), autoFlushGroup(CacheEntity.VideoCategory), createVideoCategory);
router.put("/video-categories/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.VideoCategory), updateVideoCategory);
router.delete("/video-categories/:id", autoFlushGroup(CacheEntity.VideoCategory), deleteVideoCategory);

// Package Category Master (parent = Package from /admin/packages listing)
router.get("/package-categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PackageCategory }), getPackageCategories);
router.post("/package-categories", uploadS3.single("image"), autoFlushGroup(CacheEntity.PackageCategory), createPackageCategory);
router.put("/package-categories/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.PackageCategory), updatePackageCategory);
router.delete("/package-categories/:id", autoFlushGroup(CacheEntity.PackageCategory), deletePackageCategory);

export default router;
