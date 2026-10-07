// Client notifications: feed, read/delete and image-banner routes.
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

// Public, shared-cached banner list. The per-user feed below is not cached.
router.get("/image-notifications", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ImageNotification, scope: CacheScope.Shared }), listActiveImageNotifications);

router.get("/notifications", authenticate, listMyNotifications);
// Short TTL so dashboard fan-out doesn't hit the DB on every request under load.
router.get("/notifications/count", authenticate, cacheRoute({ ttl: CACHE_TTL.UNREAD_COUNT, scope: CacheScope.User }), getUnreadCount);
router.post("/notifications/read-all", authenticate, markAllAsRead);
router.post("/notifications/:id/read", authenticate, markAsRead);

// Body: { ids: number[] } or { all: true } to clear the feed.
router.post("/notifications/delete", authenticate, deleteNotifications);

export default router;
