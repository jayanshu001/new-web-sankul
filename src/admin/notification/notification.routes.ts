import { Router } from "express";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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

// Broadcast / log
router.post("/broadcast", uploadS3.single("image"), broadcastNotification);
// Searchable picker source for the deep-link target dropdown.
router.get("/target-options", listTargetOptions);
router.get("/", listNotifications);
router.post("/bulk-delete", bulkDeleteNotifications);
router.post("/:id/cancel", cancelScheduledNotification);
router.delete("/:id", deleteNotification);

// ImageNotification CRUD (in-app banners)
router.get("/images", listImageNotifications);
router.post("/images", autoFlushGroup("image-notification"), uploadS3.single("image"), createImageNotification);
router.put("/images/:id", autoFlushGroup("image-notification"), uploadS3.single("image"), updateImageNotification);
router.delete("/images/:id", autoFlushGroup("image-notification"), deleteImageNotification);

export default router;
