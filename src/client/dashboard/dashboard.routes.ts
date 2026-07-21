import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  getDashboard,
  getFreeDashboard,
  getResumeDashboard,
} from "./dashboard.controller";

const router = Router();

router.use(authenticate);
// Dashboard is per-user (isPurchased per card + unread notifications + goal-
// prioritised ordering), so scope:"user" (never "shared" — that would leak one
// user's data). Short 60s TTL: helps rapid re-loads without serving stale
// purchase/notification state for long.
router.get("/dashboard", cacheRoute({ ttl: 60, entity: "client-dashboard", scope: "user" }), getDashboard);
// Resume is entirely the user's progress → Tier-3, not cached.
router.get("/dashboard/resume", getResumeDashboard);
// Free dashboard has per-user isPurchased on ebooks → per-user short TTL.
router.get("/free-dashboard", cacheRoute({ ttl: 60, entity: "client-dashboard", scope: "user" }), getFreeDashboard);

export default router;
