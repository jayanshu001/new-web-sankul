import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getPreRequisites,
  getCourses,
  getCourseById,
  getCourseVideoCategories,
  createCourseVideoCategory,
  updateCourseVideoCategory,
  deleteCourseVideoCategory,
  getVideoCategoryRelations,
  createVideoCategoryRelation,
  updateVideoCategoryRelation,
  deleteVideoCategoryRelation,
  getCourseMaterials,
  createCourseMaterial,
  updateCourseMaterial,
  deleteCourseMaterial,
  createCourse,
  updateCourse,
  deleteCourse,
  getCoursePlans,
  createCoursePlan,
  getCoursePlanById,
  updateCoursePlan,
  deleteCoursePlan,
} from "./course.controller";

const router = Router();

// All course management endpoints are admin-only.
router.use(authenticate, requireRole("admin", "super_admin"));

// GET pre-requisites
router.get("/pre-requisites", getPreRequisites);
router.get("/video-categories", getCourseVideoCategories);
router.post("/video-categories", createCourseVideoCategory);
router.put("/video-categories/:videoCategoryId", updateCourseVideoCategory);
router.delete("/video-categories/:videoCategoryId", deleteCourseVideoCategory);
router.get("/video-category-relations", getVideoCategoryRelations);
router.post("/video-category-relations", createVideoCategoryRelation);
router.put("/video-category-relations/:relationId", updateVideoCategoryRelation);
router.delete("/video-category-relations/:relationId", deleteVideoCategoryRelation);

router.get("/materials", getCourseMaterials);
router.post("/materials", createCourseMaterial);
router.put("/materials/:materialId", updateCourseMaterial);
router.delete("/materials/:materialId", deleteCourseMaterial);

router.get("/", getCourses);
router.get("/:id", getCourseById);

// POST create course
router.post("/", createCourse);

// PUT update course
router.put("/:id", updateCourse);

// DELETE delete course
router.delete("/:id", deleteCourse);

// Pricing Plans
router.get("/:id/plans", getCoursePlans);
router.post("/:id/plans", createCoursePlan);
router.get("/plans/:planId", getCoursePlanById);
router.put("/plans/:planId", updateCoursePlan);
router.delete("/plans/:planId", deleteCoursePlan);

export default router;
