// Client catalog tabs: videos, materials and tests tab roots for a course, package or live course.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  getCatalogVideos,
  getCatalogMaterials,
  getCatalogTests,
} from "./catalog.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Videos / Materials / Tests tab roots; :type ∈ course | package | live-course.
// videos carry per-user progress + minted media tokens → never cached.
// materials carry isPurchased → cached per user.
router.get("/:type/:id/videos", getCatalogVideos);       // ?search= ?categoryIds=a,b
router.get("/:type/:id/materials", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Material, scope: CacheScope.User }), getCatalogMaterials);  // ?search=
// tests are category-grouped counts with no per-user state → shared cache.
router.get("/:type/:id/tests", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Categories, scope: CacheScope.Shared }), getCatalogTests);

export default router;
