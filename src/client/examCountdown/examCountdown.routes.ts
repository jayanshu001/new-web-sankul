// Client exam countdown: category, upcoming and list routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  listCategories,
  listCountdowns,
  upcomingCountdowns,
} from "./examCountdown.controller";

const router = Router();

router.use(authenticate);

// No per-user field, so shared-cached; admin writes flush "exam-countdown".
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.Shared }), listCategories);
router.get("/upcoming", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.Shared }), upcomingCountdowns);
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCountdown, scope: CacheScope.Shared }), listCountdowns);

export default router;
