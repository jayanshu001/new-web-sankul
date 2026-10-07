// Admin notifications: push broadcast, schedule/cancel, log and image banner routes.
import { Router } from "express";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  broadcastNotification,
  listTargetOptions,
  bulkDeleteNotifications,
  cancelScheduledNotification,
  listNotifications,
  deleteNotification,
  listImageNotifications,
  createImageNotification,
  updateImageNotification,
  deleteImageNotification,
} from "./notification.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.post("/broadcast", uploadTo(UPLOAD_FOLDERS.notifications), uploadS3.single("image"), broadcastNotification);
router.get("/target-options", listTargetOptions);
router.get("/", listNotifications);
router.post("/bulk-delete", bulkDeleteNotifications);
router.post("/:id/cancel", cancelScheduledNotification);
router.delete("/:id", deleteNotification);

// In-app image banners
router.get("/images", listImageNotifications);
router.post("/images", autoFlushGroup(CacheEntity.ImageNotification), uploadTo(UPLOAD_FOLDERS.notifications), uploadS3.single("image"), createImageNotification);
router.put("/images/:id", autoFlushGroup(CacheEntity.ImageNotification), uploadTo(UPLOAD_FOLDERS.notifications), uploadS3.single("image"), updateImageNotification);
router.delete("/images/:id", autoFlushGroup(CacheEntity.ImageNotification), deleteImageNotification);

export default router;
