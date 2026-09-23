import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CACHE_TTL } from "../../config/cacheTtl";
import { listMySubscriptions } from "./my-subscriptions.controller";

const router = Router();

router.use(authenticate);

router.get("/", cacheRoute({ ttl: CACHE_TTL.QUICK_REFRESH, scope: CacheScope.User }), listMySubscriptions);

export default router;
