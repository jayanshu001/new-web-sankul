import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { getEducators, createEducator, updateEducator, deleteEducator } from "./educator.controller";
import { getSubjectCategories, createSubjectCategory, updateSubjectCategory, deleteSubjectCategory } from "./subjectCategory.controller";
import { getMaterials, createMaterial, updateMaterial, deleteMaterial } from "./material.controller";
import { getVideoCategories, createVideoCategory, updateVideoCategory, deleteVideoCategory } from "./videoCategory.controller";
import { getPackageCategories, createPackageCategory, updatePackageCategory, deletePackageCategory } from "./packageCategory.controller";
import { getLiveCourseCategories, createLiveCourseCategory, updateLiveCourseCategory, deleteLiveCourseCategory } from "./liveCourseCategory.controller";

const router = Router();

// All master data endpoints are admin-only.
router.use(authenticate, requireRole("admin", "super_admin"));

// Educator Master
router.get("/educators", getEducators);
router.post("/educators", uploadS3.single("image"), createEducator);
router.put("/educators/:id", uploadS3.single("image"), updateEducator);
router.delete("/educators/:id", deleteEducator);

// Subject Category Master
router.get("/subject-categories", getSubjectCategories);
router.post("/subject-categories", uploadS3.single("image"), createSubjectCategory);
router.put("/subject-categories/:id", uploadS3.single("image"), updateSubjectCategory);
router.delete("/subject-categories/:id", deleteSubjectCategory);

// Material Master
router.get("/materials", getMaterials);
router.post("/materials", uploadS3.single("image"), createMaterial);
router.put("/materials/:id", uploadS3.single("image"), updateMaterial);
router.delete("/materials/:id", deleteMaterial);

// Video Category Master
router.get("/video-categories", getVideoCategories);
router.post("/video-categories", uploadS3.single("image"), createVideoCategory);
router.put("/video-categories/:id", uploadS3.single("image"), updateVideoCategory);
router.delete("/video-categories/:id", deleteVideoCategory);

// Package Category Master (parent = Package from /admin/packages listing)
router.get("/package-categories", getPackageCategories);
router.post("/package-categories", uploadS3.single("image"), createPackageCategory);
router.put("/package-categories/:id", uploadS3.single("image"), updatePackageCategory);
router.delete("/package-categories/:id", deletePackageCategory);

// Live Course Category Master (linked from LiveCourse.liveCourseCategoryId)
router.get("/live-course-categories", getLiveCourseCategories);
router.post("/live-course-categories", uploadS3.single("image"), createLiveCourseCategory);
router.put("/live-course-categories/:id", uploadS3.single("image"), updateLiveCourseCategory);
router.delete("/live-course-categories/:id", deleteLiveCourseCategory);

export default router;
