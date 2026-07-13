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
  getCoursePromocodes,
  getCourseExamCategories,
  getCourseMaterialCategories,
  getCourseBooks,
  linkCourseBooks,
  reorderCourseBooks,
  unlinkCourseBook,
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

import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";

const router = Router();

// All course management endpoints are admin-only.
router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

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

// Route-level response cache. Reads tagged entity:"course"; the writes below
// call autoFlushGroup("course") so edits clear these instantly. See cache/ROUTE_CACHE.md.
router.get("/", cacheRoute({ ttl: 120, entity: "course" }), getCourses);
router.get("/:id", cacheRoute({ ttl: 600, entity: "course" }), getCourseById);

// POST create course
router.post("/", uploadS3.single("image"), autoFlushGroup("course"), createCourse);

// PUT update course
router.put("/:id", uploadS3.single("image"), autoFlushGroup("course"), updateCourse);

// DELETE delete course
router.delete("/:id", autoFlushGroup("course"), deleteCourse);

// PATCH toggle popular flag
router.patch("/:id/popular", autoFlushGroup("course"), toggleCoursePopular);

// Pricing Plans
router.get("/:id/plans", getCoursePlans);
router.get("/:id/promocodes", getCoursePromocodes);
router.get("/:id/exam-categories", getCourseExamCategories);
router.get("/:id/material-categories", getCourseMaterialCategories);
router.get("/:id/books", getCourseBooks);
router.post("/:id/books", autoFlushGroup("course"), linkCourseBooks);
router.put("/:id/books/reorder", autoFlushGroup("course"), reorderCourseBooks);
router.delete("/:id/books/:bookId", autoFlushGroup("course"), unlinkCourseBook);
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
