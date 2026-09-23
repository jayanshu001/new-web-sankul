import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  getPackageDetail,
  listPackages,
  listPackagesByType,
  listPackagesByGoal,
  listPackageTypes,
  listMyPackages,
  getChatMessages,
} from "./package.controller";

const router = Router();

router.use(authenticate);

// listPackages / listPackagesByType / getPackageDetail cache internally now
// (catalog-package.detail.sql.ts uses cache.aside — shared data cached,
// isPurchased/daysLeft always live). Don't wrap these in an outer
// cacheRoute({ scope: CacheScope.User }) — see course.routes.ts for why.
router.get("/", listPackages);

// Tier-1 (fully shared): package types are pure metadata, no per-user state.
router.get("/types", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PackageType, scope: CacheScope.Shared }), listPackageTypes);

// List packages by type — cached internally now, see note above.
router.get("/type/:typeId", listPackagesByType);

// List packages grouped per goal-label — enrichPackagesSql computes
// isPurchased/daysLeft live per call, see note above. Don't wrap this in an
// outer cacheRoute({ scope: CacheScope.User }) — see course.routes.ts for why.
// Pass labelIds as a comma-separated query string (sourced from /client/goals/my-goals)
router.get("/goal", listPackagesByGoal);

// Current customer's active package subscriptions — per-user, not cached.
router.get("/my", listMyPackages);

// Package chat — subscription-gated live messages, not cached.
router.get("/:packageId/chat", getChatMessages);

// Detail (catch-all — must be last) — cached internally now, see note above.
router.get("/:id", getPackageDetail);

export default router;
