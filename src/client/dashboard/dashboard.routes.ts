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
// Dashboard is per-user (isPurchased per card + unread notifications + goal-
// prioritised ordering), so scope: CacheScope.User (never "shared" — that would leak one
// user's data). Short 60s TTL: helps rapid re-loads without serving stale
// purchase/notification state for long.
router.get("/dashboard", cacheRoute({ ttl: CACHE_TTL.DASHBOARD, entity: CacheEntity.ClientDashboard, scope: CacheScope.User }), getDashboard);
// Resume is entirely the user's progress → Tier-3, not cached.
router.get("/dashboard/resume", getResumeDashboard);
// Free dashboard has per-user isPurchased on ebooks → per-user short TTL.
router.get("/free-dashboard", cacheRoute({ ttl: CACHE_TTL.DASHBOARD, entity: CacheEntity.ClientDashboard, scope: CacheScope.User }), getFreeDashboard);

export default router;
