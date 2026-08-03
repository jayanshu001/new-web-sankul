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
  toggleCourseStatus,
  getCoursePlans,
  getCoursePromocodes,
  getCourseExamCategories,
  getCourseMaterialCategories,
  getCourseBooks,
  linkCourseBooks,
  reorderCourseBooks,
  reorderCourseExamCategories,
  reorderCourseMaterialCategories,
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
// Course video-category + relation writes change catalog video composition →
// flush "video-category" (fans out to catalog-course/catalog-package/categories/
// free). Material writes flush "material".
router.get("/video-categories", getCourseVideoCategories);
router.post("/video-categories", autoFlushGroup("video-category"), createCourseVideoCategory);
router.put("/video-categories/:videoCategoryId", autoFlushGroup("video-category"), updateCourseVideoCategory);
router.delete("/video-categories/:videoCategoryId", autoFlushGroup("video-category"), deleteCourseVideoCategory);
router.get("/video-category-relations", getVideoCategoryRelations);
router.post("/video-category-relations", autoFlushGroup("video-category"), createVideoCategoryRelation);
router.put("/video-category-relations/:relationId", autoFlushGroup("video-category"), updateVideoCategoryRelation);
router.delete("/video-category-relations/:relationId", autoFlushGroup("video-category"), deleteVideoCategoryRelation);

router.get("/materials", getCourseMaterials);
router.post("/materials", autoFlushGroup("material"), createCourseMaterial);
router.put("/materials/:materialId", autoFlushGroup("material"), updateCourseMaterial);
router.delete("/materials/:materialId", autoFlushGroup("material"), deleteCourseMaterial);

// Route-level response cache. Reads tagged entity:"course"; the writes below
// call autoFlushGroup("course") so edits clear these instantly. See cache/ROUTE_CACHE.md.
router.get("/", cacheRoute({ ttl: 86400, entity: "course" }), getCourses);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "course" }), getCourseById);

// POST create course
router.post("/", uploadS3.single("image"), autoFlushGroup("course"), createCourse);

// PUT update course
router.put("/:id", uploadS3.single("image"), autoFlushGroup("course"), updateCourse);

// DELETE delete course
router.delete("/:id", autoFlushGroup("course"), deleteCourse);

// PATCH toggle popular flag
router.patch("/:id/popular", autoFlushGroup("course"), toggleCoursePopular);

// PATCH toggle status (activate/deactivate) — no required-field checks
router.patch("/:id/status", autoFlushGroup("course"), toggleCourseStatus);

// Pricing Plans
router.get("/:id/plans", getCoursePlans);
router.get("/:id/promocodes", getCoursePromocodes);
router.get("/:id/exam-categories", getCourseExamCategories);
router.put("/:id/exam-categories/reorder", autoFlushGroup("course"), reorderCourseExamCategories);
router.get("/:id/material-categories", getCourseMaterialCategories);
router.put("/:id/material-categories/reorder", autoFlushGroup("course"), reorderCourseMaterialCategories);
router.get("/:id/books", getCourseBooks);
router.post("/:id/books", autoFlushGroup("course"), linkCourseBooks);
router.put("/:id/books/reorder", autoFlushGroup("course"), reorderCourseBooks);
router.delete("/:id/books/:bookId", autoFlushGroup("course"), unlinkCourseBook);
router.post("/:id/plans", createCoursePlan);
router.get("/plans/:planId", getCoursePlanById);
router.put("/plans/:planId", updateCoursePlan);
router.delete("/plans/:planId", deleteCoursePlan);

// Videos (writes flush "video"). NOTE: GET "/videos" is shadowed by GET "/:id"
// above (pre-existing) — the reachable read is GET "/videos/:videoId".
router.get("/videos", getVideos);
router.post("/videos", autoFlushGroup("video"), createVideo);
router.post("/videos/reorder", autoFlushGroup("video"), reorderVideos);
router.get("/videos/:videoId", cacheRoute({ ttl: 86400, entity: "video" }), getVideoById);
router.put("/videos/:videoId", autoFlushGroup("video"), updateVideo);
router.delete("/videos/:videoId", autoFlushGroup("video"), deleteVideo);

export default router;
