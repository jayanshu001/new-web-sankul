import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  listVideos,
  getVideoPreRequisites,
  getVideo,
  createVideo,
  updateVideo,
  deleteVideo,
  toggleVideoStatus,
  reorderVideos,
} from "./video.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
router.get("/pre-requisites", getVideoPreRequisites);
router.post("/reorder", autoFlushGroup(CacheEntity.Video), reorderVideos);

router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Video }), listVideos);
router.post("/", autoFlushGroup(CacheEntity.Video), createVideo);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Video }), getVideo);
router.put("/:id", autoFlushGroup(CacheEntity.Video), updateVideo);
router.delete("/:id", autoFlushGroup(CacheEntity.Video), deleteVideo);
router.patch("/:id/status", autoFlushGroup(CacheEntity.Video), toggleVideoStatus);

export default router;
