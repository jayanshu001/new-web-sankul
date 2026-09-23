import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  listMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotifications,
  listActiveImageNotifications,
} from "./notification.controller";

const router = Router();

// Public — list active in-app banner images. Tier-1 shared (no per-user field);
// no dedicated entity tag → "misc", relies on TTL. The per-user feed + unread
// count below are NOT cached (live).
router.get("/image-notifications", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ImageNotification, scope: CacheScope.Shared }), listActiveImageNotifications);

// Authenticated feed
router.get("/notifications", authenticate, listMyNotifications);
// Lightweight unread badge count — short TTL so dashboard fan-out doesn't hit DB every second under load.
router.get("/notifications/count", authenticate, cacheRoute({ ttl: CACHE_TTL.UNREAD_COUNT, scope: CacheScope.User }), getUnreadCount);
router.post("/notifications/read-all", authenticate, markAllAsRead);
router.post("/notifications/:id/read", authenticate, markAsRead);

// Delete ("dismiss from my feed") — single, multi, or all via one endpoint.
// Body: { ids: number[] } to delete specific ones, or { all: true } to clear the feed.
router.post("/notifications/delete", authenticate, deleteNotifications);

export default router;
