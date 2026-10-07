// Admin dashboard: overview route (short-lived shared cache).
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { getDashboard, getDashboardRecent, getDashboardTrending } from "./dashboard.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate
// The most expensive admin read (~25 queries, several full-range aggregates over
// the biggest tables) and identical for every admin (req.user is only logged), so
// one Shared cache entry serves the whole team. TTL is deliberately short (2 min):
// this is live revenue and no admin write flushes it. The key includes the query
// string, so each range combination caches separately.
router.get("/", cacheRoute({ ttl: CACHE_TTL.ADMIN_DASHBOARD, entity: CacheEntity.AdminDashboard, scope: CacheScope.Shared }), getDashboard);
// Top sellers inside the dashboard's single date filter (range/fromDate/toDate).
// Fetched lazily per card, kept out of the main payload so it never slows the first paint.
router.get("/trending", cacheRoute({ ttl: CACHE_TTL.ADMIN_DASHBOARD, entity: CacheEntity.AdminDashboard, scope: CacheScope.Shared }), getDashboardTrending);
// Next pages of the Activity cards' recent list for the same date filter; page one ships in "/".
router.get("/recent", cacheRoute({ ttl: CACHE_TTL.ADMIN_DASHBOARD, entity: CacheEntity.AdminDashboard, scope: CacheScope.Shared }), getDashboardRecent);

export default router;
