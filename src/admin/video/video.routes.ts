import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
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

router.get("/pre-requisites", getVideoPreRequisites);
router.post("/reorder", reorderVideos);

router.get("/", listVideos);
router.post("/", createVideo);
router.get("/:id", getVideo);
router.put("/:id", updateVideo);
router.delete("/:id", deleteVideo);
router.patch("/:id/status", toggleVideoStatus);

export default router;
