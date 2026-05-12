import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  broadcastNotification,
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

router.use(authenticate, requireRole("admin", "super_admin"));

// Broadcast / log
router.post("/broadcast", uploadS3.single("image"), broadcastNotification);
router.get("/", listNotifications);
router.post("/bulk-delete", bulkDeleteNotifications);
router.post("/:id/cancel", cancelScheduledNotification);
router.delete("/:id", deleteNotification);

// ImageNotification CRUD (in-app banners)
router.get("/images", listImageNotifications);
router.post("/images", uploadS3.single("image"), createImageNotification);
router.put("/images/:id", uploadS3.single("image"), updateImageNotification);
router.delete("/images/:id", deleteImageNotification);

export default router;
