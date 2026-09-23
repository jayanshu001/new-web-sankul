import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { applyPromocode, listPromocodes } from "./promocode.controller";

const router = Router();

router.use(authenticate);

// Tier-1 (public active-window promocode list, identical for all users). Admin
// promocode writes flush "promo-code" (see docs/CACHING.md).
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PromoCode, scope: CacheScope.Shared }), listPromocodes);
router.post("/apply", applyPromocode);

export default router;
