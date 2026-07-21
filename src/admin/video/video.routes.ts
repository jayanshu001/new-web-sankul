import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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
router.post("/reorder", autoFlushGroup("video"), reorderVideos);

router.get("/", cacheRoute({ ttl: 86400, entity: "video" }), listVideos);
router.post("/", autoFlushGroup("video"), createVideo);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "video" }), getVideo);
router.put("/:id", autoFlushGroup("video"), updateVideo);
router.delete("/:id", autoFlushGroup("video"), deleteVideo);
router.patch("/:id/status", autoFlushGroup("video"), toggleVideoStatus);

export default router;
