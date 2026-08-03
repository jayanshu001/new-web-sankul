import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
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

router.get("/", cacheRoute({ ttl: 86400, entity: "video-category" }), listVideoCategories);
router.post("/", uploadS3.single("image"), autoFlushGroup("video-category"), createVideoCategory);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "video-category" }), getVideoCategory);
router.get("/:id/sub-categories", listVideoCategorySubCategories);
router.get("/:id/courses", listVideoCategoryCourses);
router.get("/:id/videos", listVideoCategoryVideos);
router.put("/:id", uploadS3.single("image"), autoFlushGroup("video-category"), updateVideoCategory);
router.delete("/:id", autoFlushGroup("video-category"), deleteVideoCategory);
router.patch("/:id/status", autoFlushGroup("video-category"), toggleVideoCategoryStatus);
router.post("/:id/duplicate", autoFlushGroup("video-category"), duplicateVideoCategory);

export default router;
