import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  broadcastNotification,
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
router.post("/broadcast", broadcastNotification);
router.get("/", listNotifications);
router.delete("/:id", deleteNotification);

// ImageNotification CRUD (in-app banners)
router.get("/images", listImageNotifications);
router.post("/images", createImageNotification);
router.put("/images/:id", updateImageNotification);
router.delete("/images/:id", deleteImageNotification);

export default router;
