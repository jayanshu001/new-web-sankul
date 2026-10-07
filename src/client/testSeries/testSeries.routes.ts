// Client test series: catalog, papers, checkout preview and subscription routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  listTestSeries,
  getTestSeriesDetail,
  listSeriesPapers,
  previewCheckout,
  listMySubscriptions,
} from "./testSeries.controller";

const router = Router();

router.use(authenticate);

router.get("/my/subscriptions",       listMySubscriptions);
router.post("/checkout/preview",      previewCheckout);

// Per-user isPurchased overlay → per-user key. The 24h TTL is not the freshness
// mechanism: admin test-series writes autoFlush CacheEntity.TestSeries across all
// users. Without an entity these keys land in "misc", which no flush reaches.
const TS = { ttl: CACHE_TTL.DAY, entity: CacheEntity.TestSeries as const, scope: CacheScope.User as const };

router.get("/",                       cacheRoute(TS), listTestSeries);
router.get("/:id",                    cacheRoute(TS), getTestSeriesDetail);
router.get("/:id/papers",             cacheRoute(TS), listSeriesPapers);

export default router;
