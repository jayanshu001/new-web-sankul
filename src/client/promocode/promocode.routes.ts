// Client promocodes: list and apply routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { applyPromocode, listPromocodes } from "./promocode.controller";

const router = Router();

router.use(authenticate);

// Shared cache: identical for all users; admin promocode writes flush "promo-code".
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PromoCode, scope: CacheScope.Shared }), listPromocodes);
router.post("/apply", applyPromocode);

export default router;
