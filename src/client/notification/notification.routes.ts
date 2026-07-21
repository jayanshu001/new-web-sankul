import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotifications,
  listActiveImageNotifications,
} from "./notification.controller";

const router = Router();

// Public — list active in-app banner images
router.get("/image-notifications", listActiveImageNotifications);

// Authenticated feed
router.get("/notifications", authenticate, listMyNotifications);
// Lightweight unread badge count — kept BEFORE the "/:id/read" param route so
// "count" is never captured as an :id. Refreshes the bell without the full feed.
router.get("/notifications/count", authenticate, getUnreadCount);
router.post("/notifications/read-all", authenticate, markAllAsRead);
router.post("/notifications/:id/read", authenticate, markAsRead);

// Delete ("dismiss from my feed") — single, multi, or all via one endpoint.
// Body: { ids: number[] } to delete specific ones, or { all: true } to clear the feed.
router.post("/notifications/delete", authenticate, deleteNotifications);

export default router;
