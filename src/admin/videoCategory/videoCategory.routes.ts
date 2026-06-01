import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  listVideoCategories,
  getVideoCategoryPreRequisites,
  getVideoCategory,
  listVideoCategoryCourses,
  listVideoCategoryVideos,
  createVideoCategory,
  updateVideoCategory,
  deleteVideoCategory,
  toggleVideoCategoryStatus,
  duplicateVideoCategory,
} from "./videoCategory.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/pre-requisites", getVideoCategoryPreRequisites);

router.get("/", listVideoCategories);
router.post("/", uploadS3.single("image"), createVideoCategory);
router.get("/:id", getVideoCategory);
router.get("/:id/courses", listVideoCategoryCourses);
router.get("/:id/videos", listVideoCategoryVideos);
router.put("/:id", uploadS3.single("image"), updateVideoCategory);
router.delete("/:id", deleteVideoCategory);
router.patch("/:id/status", toggleVideoCategoryStatus);
router.post("/:id/duplicate", duplicateVideoCategory);

export default router;
