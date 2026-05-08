import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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
  toggleCoursePopular,
  getCoursePlans,
  createCoursePlan,
  getCoursePlanById,
  updateCoursePlan,
  deleteCoursePlan,
} from "./course.controller";
import {
  getVideos,
  getVideoById,
  createVideo,
  updateVideo,
  deleteVideo,
  reorderVideos,
} from "./video.controller";

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
router.post("/", uploadS3.single("image"), createCourse);

// PUT update course
router.put("/:id", uploadS3.single("image"), updateCourse);

// DELETE delete course
router.delete("/:id", deleteCourse);

// PATCH toggle popular flag
router.patch("/:id/popular", toggleCoursePopular);

// Pricing Plans
router.get("/:id/plans", getCoursePlans);
router.post("/:id/plans", createCoursePlan);
router.get("/plans/:planId", getCoursePlanById);
router.put("/plans/:planId", updateCoursePlan);
router.delete("/plans/:planId", deleteCoursePlan);

// Videos
router.get("/videos", getVideos);
router.post("/videos", createVideo);
router.post("/videos/reorder", reorderVideos);
router.get("/videos/:videoId", getVideoById);
router.put("/videos/:videoId", updateVideo);
router.delete("/videos/:videoId", deleteVideo);

export default router;
