// Client packages: catalog, type, goal, my-packages and chat routes.
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

// listPackages / listPackagesByType / getPackageDetail cache internally (shared data
// cached, isPurchased/daysLeft always live). Don't wrap them in
// cacheRoute({ scope: CacheScope.User }); see course.routes.ts for why.
router.get("/", listPackages);

router.get("/types", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PackageType, scope: CacheScope.Shared }), listPackageTypes);

router.get("/type/:typeId", listPackagesByType);

// isPurchased/daysLeft computed live per call; same no-outer-cache rule as above.
router.get("/goal", listPackagesByGoal);

router.get("/my", listMyPackages);

router.get("/:packageId/chat", getChatMessages);

// Catch-all; must be last.
router.get("/:id", getPackageDetail);

export default router;
