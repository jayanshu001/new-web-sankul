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

// Tier-2 (per-user isPurchased overlay). No dedicated test-series catalog tag →
// "misc"; a short per-user TTL bounds staleness (ebook precedent).
router.get("/",                       cacheRoute({ ttl: 86400, scope: "user" }), listTestSeries);
router.get("/:id",                    cacheRoute({ ttl: 86400, scope: "user" }), getTestSeriesDetail);
router.get("/:id/papers",             cacheRoute({ ttl: 86400, scope: "user" }), listSeriesPapers);

export default router;
