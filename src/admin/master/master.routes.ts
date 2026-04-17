import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getEducators, createEducator, updateEducator, deleteEducator } from "./educator.controller";
import { getSubjectCategories, createSubjectCategory, updateSubjectCategory, deleteSubjectCategory } from "./subjectCategory.controller";
import { getMaterials, createMaterial, updateMaterial, deleteMaterial } from "./material.controller";
import { getVideoCategories, createVideoCategory, updateVideoCategory, deleteVideoCategory } from "./videoCategory.controller";

const router = Router();

// All master data endpoints are admin-only.
router.use(authenticate, requireRole("admin", "super_admin"));

// Educator Master
router.get("/educators", getEducators);
router.post("/educators", createEducator);
router.put("/educators/:id", updateEducator);
router.delete("/educators/:id", deleteEducator);

// Subject Category Master
router.get("/subject-categories", getSubjectCategories);
router.post("/subject-categories", createSubjectCategory);
router.put("/subject-categories/:id", updateSubjectCategory);
router.delete("/subject-categories/:id", deleteSubjectCategory);

// Material Master
router.get("/materials", getMaterials);
router.post("/materials", createMaterial);
router.put("/materials/:id", updateMaterial);
router.delete("/materials/:id", deleteMaterial);

// Video Category Master
router.get("/video-categories", getVideoCategories);
router.post("/video-categories", createVideoCategory);
router.put("/video-categories/:id", updateVideoCategory);
router.delete("/video-categories/:id", deleteVideoCategory);

export default router;
