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
// videos = Tier-3 (per-user progress + minted media tokens) → never cached.
// materials = Tier-2 (isPurchased) → cached per-user + short TTL (ebook precedent).
router.get("/:type/:id/videos", getCatalogVideos);       // ?search= ?categoryIds=a,b
router.get("/:type/:id/materials", cacheRoute({ ttl: 86400, entity: "material", scope: "user" }), getCatalogMaterials);  // ?search=
// Tier-1: tests tab is category-grouped counts only, no per-user state.
router.get("/:type/:id/tests", cacheRoute({ ttl: 86400, entity: "categories", scope: "shared" }), getCatalogTests);

export default router;
