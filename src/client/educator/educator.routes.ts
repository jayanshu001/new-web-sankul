import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { getEducatorWithCoursesHandler } from "./educator.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Tier-2 (embeds a per-user course isPurchased overlay via customerId) → cached
// per-user + short TTL (ebook precedent). Admin educator writes flush "educator".
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Educator, scope: CacheScope.User }), getEducatorWithCoursesHandler);

export default router;
