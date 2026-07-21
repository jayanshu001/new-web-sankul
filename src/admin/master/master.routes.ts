import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  getEducators, getEducatorById, createEducator, updateEducator, deleteEducator, getEducatorDetails,
  getEducatorCourses, getEducatorLiveCourses, getEducatorPackages,
  getEducatorVideoCategories, getEducatorLiveSessions,
} from "./educator.controller";
import { getSubjectCategories, getSubjectCategoryById, createSubjectCategory, updateSubjectCategory, deleteSubjectCategory } from "./subjectCategory.controller";
import { getMaterials, createMaterial, updateMaterial, deleteMaterial } from "./material.controller";
import { getVideoCategories, createVideoCategory, updateVideoCategory, deleteVideoCategory } from "./videoCategory.controller";
import { getPackageCategories, createPackageCategory, updatePackageCategory, deletePackageCategory } from "./packageCategory.controller";

const router = Router();

// All master data endpoints are admin-only.
router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Each master tags its entity; the relational drill-down GETs (/:id/courses etc.)
// stay uncached. Writes flush the entity + the client caches embedding it.

// Educator Master
router.get("/educators", cacheRoute({ ttl: 86400, entity: "educator" }), getEducators);
router.get("/educators/:id", cacheRoute({ ttl: 86400, entity: "educator" }), getEducatorById);
router.get("/educators/:id/details", cacheRoute({ ttl: 86400, entity: "educator" }), getEducatorDetails);
router.get("/educators/:id/courses", getEducatorCourses);
router.get("/educators/:id/live-courses", getEducatorLiveCourses);
router.get("/educators/:id/video-categories", getEducatorVideoCategories);
router.get("/educators/:id/live-sessions", getEducatorLiveSessions);
router.get("/educators/:id/packages", getEducatorPackages);
router.post("/educators", uploadS3.single("image"), autoFlushGroup("educator"), createEducator);
router.put("/educators/:id", uploadS3.single("image"), autoFlushGroup("educator"), updateEducator);
router.delete("/educators/:id", autoFlushGroup("educator"), deleteEducator);

// Subject Category Master
router.get("/subject-categories", cacheRoute({ ttl: 86400, entity: "course-subject-category" }), getSubjectCategories);
router.get("/subject-categories/:id", cacheRoute({ ttl: 86400, entity: "course-subject-category" }), getSubjectCategoryById);
router.post("/subject-categories", uploadS3.single("image"), autoFlushGroup("course-subject-category"), createSubjectCategory);
router.put("/subject-categories/:id", uploadS3.single("image"), autoFlushGroup("course-subject-category"), updateSubjectCategory);
router.delete("/subject-categories/:id", autoFlushGroup("course-subject-category"), deleteSubjectCategory);

// Material Master
router.get("/materials", cacheRoute({ ttl: 86400, entity: "material" }), getMaterials);
router.post("/materials", uploadS3.single("image"), autoFlushGroup("material"), createMaterial);
router.put("/materials/:id", uploadS3.single("image"), autoFlushGroup("material"), updateMaterial);
router.delete("/materials/:id", autoFlushGroup("material"), deleteMaterial);

// Video Category Master
router.get("/video-categories", cacheRoute({ ttl: 86400, entity: "video-category" }), getVideoCategories);
router.post("/video-categories", uploadS3.single("image"), autoFlushGroup("video-category"), createVideoCategory);
router.put("/video-categories/:id", uploadS3.single("image"), autoFlushGroup("video-category"), updateVideoCategory);
router.delete("/video-categories/:id", autoFlushGroup("video-category"), deleteVideoCategory);

// Package Category Master (parent = Package from /admin/packages listing)
router.get("/package-categories", cacheRoute({ ttl: 86400, entity: "package-category" }), getPackageCategories);
router.post("/package-categories", uploadS3.single("image"), autoFlushGroup("package-category"), createPackageCategory);
router.put("/package-categories/:id", uploadS3.single("image"), autoFlushGroup("package-category"), updatePackageCategory);
router.delete("/package-categories/:id", autoFlushGroup("package-category"), deletePackageCategory);

export default router;
