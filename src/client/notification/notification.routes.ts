import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listMyNotifications,
  markAsRead,
  markAllAsRead,
  listActiveImageNotifications,
} from "./notification.controller";

const router = Router();

// Public — list active in-app banner images
router.get("/image-notifications", listActiveImageNotifications);

// Authenticated feed
router.get("/notifications", authenticate, listMyNotifications);
router.post("/notifications/read-all", authenticate, markAllAsRead);
router.post("/notifications/:id/read", authenticate, markAsRead);

export default router;
