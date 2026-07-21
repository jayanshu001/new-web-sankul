import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { applyPromocode, listPromocodes } from "./promocode.controller";

const router = Router();

router.use(authenticate);

// Tier-1 (public active-window promocode list, identical for all users). Admin
// promocode writes flush "promo-code" (see docs/CACHING.md).
router.get("/", cacheRoute({ ttl: 86400, entity: "promo-code", scope: "shared" }), listPromocodes);
router.post("/apply", applyPromocode);

export default router;
