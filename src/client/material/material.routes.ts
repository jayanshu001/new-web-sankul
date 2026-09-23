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

// Tier-2 (isPurchased overlay) → cached per-user + short TTL (ebook precedent),
// entity: CacheEntity.Material (admin material writes flush it). track-download is a write.

// Tree drill-down: child categories + leaf materials at this node
router.get("/categories/:id/contents", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getCategoryContents);

// Recently added materials
router.get("/recent", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getRecentMaterials);

// Single material detail + download tracking
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getMaterialDetail);
router.post("/:id/track-download", trackDownload);

export default router;
