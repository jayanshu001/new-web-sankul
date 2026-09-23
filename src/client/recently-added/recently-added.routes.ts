import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { listRecentlyAdded } from "./recently-added.controller";

const router = Router();

router.use(authenticate);
// GET /api/v1/client/recently-added — combined Planner/Smart/Live "View All" feed.
// Tier-2 mixed product feed (per-user isPurchased) → cached per-user + short TTL
// (ebook precedent), entity: CacheEntity.Categories so product writes flush it.
router.get("/recently-added", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Categories, scope: CacheScope.User }), listRecentlyAdded);

export default router;
