// Client recently added: list route.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { listRecentlyAdded } from "./recently-added.controller";

const router = Router();

router.use(authenticate);
// Per-user isPurchased → cached per user; tagged Categories so product writes flush it.
router.get("/recently-added", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Categories, scope: CacheScope.User }), listRecentlyAdded);

export default router;
