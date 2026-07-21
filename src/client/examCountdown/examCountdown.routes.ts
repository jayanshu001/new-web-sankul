import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  listCategories,
  listCountdowns,
  upcomingCountdowns,
} from "./examCountdown.controller";

const router = Router();

router.use(authenticate);

// Tier-1 (fully shared, no per-user field) — cache shared + short TTL. Admin
// exam-countdown writes flush "exam-countdown" (see docs/CACHING.md).
router.get("/categories", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "shared" }), listCategories);
router.get("/upcoming", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "shared" }), upcomingCountdowns);
router.get("/", cacheRoute({ ttl: 86400, entity: "exam-countdown", scope: "shared" }), listCountdowns);

export default router;
