import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  getCatalogVideos,
  getCatalogMaterials,
  getCatalogTests,
} from "./catalog.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Unified Videos / Materials / Tests tab roots for course | package | live-course.
// :type ∈ course | package | live-course
// videos (progress) + materials (isPurchased) are Tier-2 → deferred, not cached.
router.get("/:type/:id/videos", getCatalogVideos);       // ?search= ?categoryIds=a,b
router.get("/:type/:id/materials", getCatalogMaterials);  // ?search=
// Tier-1: tests tab is category-grouped counts only, no per-user state.
router.get("/:type/:id/tests", cacheRoute({ ttl: 300, entity: "categories", scope: "shared" }), getCatalogTests);

export default router;
