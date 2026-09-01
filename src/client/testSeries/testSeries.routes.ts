import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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

// Tier-2 (per-user isPurchased overlay), so the key is per-user and the TTL is a
// full day. That TTL is NOT the freshness mechanism — the `entity` tag is: every
// admin test-series write carries autoFlushGroup("test-series"), which sweeps this
// tag across ALL users. These routes previously passed no entity, which bucketed
// them under "misc" where no flush could ever reach them; a newly added price plan
// then stayed invisible per-user for the full 24h.
const TS = { ttl: 86400, entity: "test-series" as const, scope: "user" as const };

router.get("/",                       cacheRoute(TS), listTestSeries);
router.get("/:id",                    cacheRoute(TS), getTestSeriesDetail);
router.get("/:id/papers",             cacheRoute(TS), listSeriesPapers);

export default router;
