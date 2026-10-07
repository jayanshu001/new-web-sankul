// Admin courses: course, plan, linked content, video-category and video routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
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

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.get("/pre-requisites", getPreRequisites);
// Video-category/relation writes change catalog video composition, so they flush
// "video-category" (fans out to catalog-course/catalog-package/categories/free).
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

// create/update/delete + material-categories/reorder also flush "material": they
// rewrite ws_material_category_course, which /client/catalog/course/:id/materials
// and /client/materials read (cached under "material", not "course").
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Course }), getCourses);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Course }), getCourseById);

router.post("/", uploadTo(UPLOAD_FOLDERS.package), uploadS3.single("image"), autoFlushGroup(CacheEntity.Course, CacheEntity.Material), createCourse);

router.put("/:id", uploadTo(UPLOAD_FOLDERS.package), uploadS3.single("image"), autoFlushGroup(CacheEntity.Course, CacheEntity.Material), updateCourse);

router.delete("/:id", autoFlushGroup(CacheEntity.Course, CacheEntity.Material), deleteCourse);

router.patch("/:id/popular", autoFlushGroup(CacheEntity.Course), toggleCoursePopular);

// Status toggle skips required-field checks.
router.patch("/:id/status", autoFlushGroup(CacheEntity.Course), toggleCourseStatus);

router.get("/:id/plans", getCoursePlans);
router.get("/:id/promocodes", getCoursePromocodes);
router.get("/:id/exam-categories", getCourseExamCategories);
router.put("/:id/exam-categories/reorder", autoFlushGroup(CacheEntity.Course), reorderCourseExamCategories);
router.get("/:id/material-categories", getCourseMaterialCategories);
router.put("/:id/material-categories/reorder", autoFlushGroup(CacheEntity.Course, CacheEntity.Material), reorderCourseMaterialCategories);
router.get("/:id/books", getCourseBooks);
router.post("/:id/books", autoFlushGroup(CacheEntity.Course), linkCourseBooks);
router.put("/:id/books/reorder", autoFlushGroup(CacheEntity.Course), reorderCourseBooks);
router.delete("/:id/books/:bookId", autoFlushGroup(CacheEntity.Course), unlinkCourseBook);
// Plans/prices are embedded in every cached course detail/list, hence the Plan flush.
router.post("/:id/plans", autoFlushGroup(CacheEntity.Plan), createCoursePlan);
router.get("/plans/:planId", getCoursePlanById);
router.put("/plans/:planId", autoFlushGroup(CacheEntity.Plan), updateCoursePlan);
router.delete("/plans/:planId", autoFlushGroup(CacheEntity.Plan), deleteCoursePlan);

// GET "/videos" is shadowed by GET "/:id" above; the reachable read is GET "/videos/:videoId".

router.get("/videos", getVideos);
router.post("/videos", autoFlushGroup(CacheEntity.Video), createVideo);
router.post("/videos/reorder", autoFlushGroup(CacheEntity.Video), reorderVideos);
router.get("/videos/:videoId", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Video }), getVideoById);
router.put("/videos/:videoId", autoFlushGroup(CacheEntity.Video), updateVideo);
router.delete("/videos/:videoId", autoFlushGroup(CacheEntity.Video), deleteVideo);

export default router;
