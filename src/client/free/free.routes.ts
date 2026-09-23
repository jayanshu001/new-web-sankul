import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listFreeTests,
  listFreeMaterials,
  listFreeVideos,
  listFreeEbooks,
  listFreeCourses,
} from "./free.controller";
import {
  reportFreeVideoProgress,
  listFreeVideoResume,
} from "./freeProgress.controller";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";

const router = Router();

router.use(authenticate);

// free-tests/-ebooks/-courses embed per-user attempt stats / isPurchased →
// Tier-2, cached per-user + short TTL (ebook precedent), entity: CacheEntity.Free.
router.get("/free-tests", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeTests);
// free-materials is Tier-1 (its customerId arg is unused → identical for all).
// free-videos mints a CUSTOMER-BOUND mediaToken per row (shapeVideo → cust:id),
// so it MUST be scope: CacheScope.User — a shared key would serve one user's token to all.
router.get("/free-materials", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.Shared }), listFreeMaterials);
router.get("/free-videos", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeVideos);
// "/free-videos/resume" must precede the ":videoId" route so it isn't captured
// as a video id; the heartbeat lives under the same /free-videos prefix. Per-user
// resume + progress writes stay uncached.
router.get("/free-videos/resume", listFreeVideoResume);
router.post("/free-videos/:videoId/progress", reportFreeVideoProgress);
router.get("/free-ebooks", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeEbooks);
router.get("/free-courses", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeCourses);

export default router;
