// Client free content: free catalog lists and free-video progress routes.
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

// free-tests/-ebooks/-courses embed per-user attempt stats / isPurchased → per-user cache.
router.get("/free-tests", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeTests);
// free-materials is identical for all users → shared. free-videos mints a
// customer-bound mediaToken per row, so it MUST be per-user or one user's token leaks to all.
router.get("/free-materials", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.Shared }), listFreeMaterials);
router.get("/free-videos", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeVideos);
// "/free-videos/resume" must precede ":videoId" so it isn't captured as an id.
// Resume + progress writes stay uncached.
router.get("/free-videos/resume", listFreeVideoResume);
router.post("/free-videos/:videoId/progress", reportFreeVideoProgress);
router.get("/free-ebooks", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeEbooks);
router.get("/free-courses", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Free, scope: CacheScope.User }), listFreeCourses);

export default router;
