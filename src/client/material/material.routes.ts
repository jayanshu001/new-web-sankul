// Client materials: category contents, detail, recent and download-tracking routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  getCategoryContents,
  getMaterialDetail,
  trackDownload,
  getRecentMaterials,
} from "./material.controller";

const router = Router();

router.use(authenticate);

// isPurchased overlay → per-user cache, flushed by admin material writes.

router.get("/categories/:id/contents", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getCategoryContents);

router.get("/recent", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getRecentMaterials);

router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getMaterialDetail);
router.post("/:id/track-download", trackDownload);

export default router;
