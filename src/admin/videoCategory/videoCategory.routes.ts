import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  listVideoCategories,
  getVideoCategoryPreRequisites,
  getVideoCategory,
  listVideoCategorySubCategories,
  listVideoCategoryCourses,
  listVideoCategoryVideos,
  createVideoCategory,
  updateVideoCategory,
  deleteVideoCategory,
  toggleVideoCategoryStatus,
  duplicateVideoCategory,
} from "./videoCategory.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
router.get("/pre-requisites", getVideoCategoryPreRequisites);

router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.VideoCategory }), listVideoCategories);
router.post("/", uploadS3.single("image"), autoFlushGroup(CacheEntity.VideoCategory), createVideoCategory);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.VideoCategory }), getVideoCategory);
router.get("/:id/sub-categories", listVideoCategorySubCategories);
router.get("/:id/courses", listVideoCategoryCourses);
router.get("/:id/videos", listVideoCategoryVideos);
router.put("/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.VideoCategory), updateVideoCategory);
router.delete("/:id", autoFlushGroup(CacheEntity.VideoCategory), deleteVideoCategory);
router.patch("/:id/status", autoFlushGroup(CacheEntity.VideoCategory), toggleVideoCategoryStatus);
router.post("/:id/duplicate", autoFlushGroup(CacheEntity.VideoCategory), duplicateVideoCategory);

export default router;
