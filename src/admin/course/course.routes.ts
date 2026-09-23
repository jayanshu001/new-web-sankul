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
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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
router.post("/video-categories", autoFlushGroup(CacheEntity.VideoCategory), createCourseVideoCategory);
router.put("/video-categories/:videoCategoryId", autoFlushGroup(CacheEntity.VideoCategory), updateCourseVideoCategory);
router.delete("/video-categories/:videoCategoryId", autoFlushGroup(CacheEntity.VideoCategory), deleteCourseVideoCategory);
router.get("/video-category-relations", getVideoCategoryRelations);
router.post("/video-category-relations", autoFlushGroup(CacheEntity.VideoCategory), createVideoCategoryRelation);
router.put("/video-category-relations/:relationId", autoFlushGroup(CacheEntity.VideoCategory), updateVideoCategoryRelation);
router.delete("/video-category-relations/:relationId", autoFlushGroup(CacheEntity.VideoCategory), deleteVideoCategoryRelation);

router.get("/materials", getCourseMaterials);
router.post("/materials", autoFlushGroup(CacheEntity.Material), createCourseMaterial);
router.put("/materials/:materialId", autoFlushGroup(CacheEntity.Material), updateCourseMaterial);
router.delete("/materials/:materialId", autoFlushGroup(CacheEntity.Material), deleteCourseMaterial);

// Route-level response cache. Reads tagged entity: CacheEntity.Course; the writes below
// call autoFlushGroup(CacheEntity.Course) so edits clear these instantly. See cache/ROUTE_CACHE.md.
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Course }), getCourses);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Course }), getCourseById);

// POST create course
router.post("/", uploadS3.single("image"), autoFlushGroup(CacheEntity.Course), createCourse);

// PUT update course
router.put("/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.Course), updateCourse);

// DELETE delete course
router.delete("/:id", autoFlushGroup(CacheEntity.Course), deleteCourse);

// PATCH toggle popular flag
router.patch("/:id/popular", autoFlushGroup(CacheEntity.Course), toggleCoursePopular);

// PATCH toggle status (activate/deactivate) — no required-field checks
router.patch("/:id/status", autoFlushGroup(CacheEntity.Course), toggleCourseStatus);

// Pricing Plans
router.get("/:id/plans", getCoursePlans);
router.get("/:id/promocodes", getCoursePromocodes);
router.get("/:id/exam-categories", getCourseExamCategories);
router.put("/:id/exam-categories/reorder", autoFlushGroup(CacheEntity.Course), reorderCourseExamCategories);
router.get("/:id/material-categories", getCourseMaterialCategories);
router.put("/:id/material-categories/reorder", autoFlushGroup(CacheEntity.Course), reorderCourseMaterialCategories);
router.get("/:id/books", getCourseBooks);
router.post("/:id/books", autoFlushGroup(CacheEntity.Course), linkCourseBooks);
router.put("/:id/books/reorder", autoFlushGroup(CacheEntity.Course), reorderCourseBooks);
router.delete("/:id/books/:bookId", autoFlushGroup(CacheEntity.Course), unlinkCourseBook);
// flush CacheEntity.Plan — was unflushed: plans/prices are embedded in every
// cached course detail/list (see flushGroups.ts's "plan" group).
router.post("/:id/plans", autoFlushGroup(CacheEntity.Plan), createCoursePlan);
router.get("/plans/:planId", getCoursePlanById);
router.put("/plans/:planId", autoFlushGroup(CacheEntity.Plan), updateCoursePlan);
router.delete("/plans/:planId", autoFlushGroup(CacheEntity.Plan), deleteCoursePlan);

// Videos (writes flush "video"). NOTE: GET "/videos" is shadowed by GET "/:id"
// above (pre-existing) — the reachable read is GET "/videos/:videoId".
router.get("/videos", getVideos);
router.post("/videos", autoFlushGroup(CacheEntity.Video), createVideo);
router.post("/videos/reorder", autoFlushGroup(CacheEntity.Video), reorderVideos);
router.get("/videos/:videoId", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Video }), getVideoById);
router.put("/videos/:videoId", autoFlushGroup(CacheEntity.Video), updateVideo);
router.delete("/videos/:videoId", autoFlushGroup(CacheEntity.Video), deleteVideo);

export default router;
