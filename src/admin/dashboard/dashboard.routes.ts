import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { getDashboard } from "./dashboard.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate
// The single most expensive admin read: ~25 queries, several of them full-range
// aggregates over the biggest tables. It is also identical for every admin (the
// handler reads req.user only for logs) and inherently a few-seconds-stale view, so
// scope: CacheScope.Shared gives one entry for the whole team.
//
// TTL is deliberately SHORT (2 min), unlike the 24h catalog caches: this is live
// revenue and no admin write flushes it. Two minutes is the difference between one
// team reloading a dashboard and N admins each re-running the year aggregate.
// Cache key includes the query string, so each range combination caches separately.
router.get("/", cacheRoute({ ttl: CACHE_TTL.ADMIN_DASHBOARD, entity: CacheEntity.AdminDashboard, scope: CacheScope.Shared }), getDashboard);

export default router;
