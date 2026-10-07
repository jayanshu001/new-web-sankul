// Client goals: active goals, my-goals and goal update routes.
import { Router } from "express";
import {
  fetchActiveGoalsHandler,
  fetchMySelectedGoalsHandler,
  updateMyGoalsHandler,
} from "./goal.client.controller";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";

const router = Router();

// Shared cache: active goals are identical for all users; admin goal writes flush "goal".
// my-goals is per-user and stays uncached.
router.get("/", authenticate, cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Goal, scope: CacheScope.Shared }), fetchActiveGoalsHandler);

router.get("/my-goals", authenticate, fetchMySelectedGoalsHandler);

// Also writable via /client/profile/update.
router.put("/", authenticate, updateMyGoalsHandler);

export default router;
