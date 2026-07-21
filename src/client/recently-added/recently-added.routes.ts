import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { listRecentlyAdded } from "./recently-added.controller";

const router = Router();

router.use(authenticate);
// GET /api/v1/client/recently-added — combined Planner/Smart/Live "View All" feed.
// Tier-2 mixed product feed (per-user isPurchased) → cached per-user + short TTL
// (ebook precedent), entity:"categories" so product writes flush it.
router.get("/recently-added", cacheRoute({ ttl: 86400, entity: "categories", scope: "user" }), listRecentlyAdded);

export default router;
