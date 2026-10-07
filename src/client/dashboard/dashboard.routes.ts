// Client dashboard: home, resume and free dashboard routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  getDashboard,
  getFreeDashboard,
  getResumeDashboard,
} from "./dashboard.controller";

const router = Router();

router.use(authenticate);
// Per-user (isPurchased, unread notifications, goal ordering) → never shared. The 60s
// TTL absorbs rapid reloads without serving stale purchase/notification state for long.
router.get("/dashboard", cacheRoute({ ttl: CACHE_TTL.DASHBOARD, entity: CacheEntity.ClientDashboard, scope: CacheScope.User }), getDashboard);
// Resume is entirely the user's progress → not cached.
router.get("/dashboard/resume", getResumeDashboard);
// Per-user isPurchased on ebooks → per-user cache.
router.get("/free-dashboard", cacheRoute({ ttl: CACHE_TTL.DASHBOARD, entity: CacheEntity.ClientDashboard, scope: CacheScope.User }), getFreeDashboard);

export default router;
