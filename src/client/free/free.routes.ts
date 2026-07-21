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
import { cacheRoute } from "../../middlewares/cacheRoute";

const router = Router();

router.use(authenticate);

// free-tests/-ebooks/-courses embed per-user attempt stats / isPurchased →
// Tier-2, cached per-user + short TTL (ebook precedent), entity:"free".
router.get("/free-tests", cacheRoute({ ttl: 86400, entity: "free", scope: "user" }), listFreeTests);
// free-materials is Tier-1 (its customerId arg is unused → identical for all).
// free-videos mints a CUSTOMER-BOUND mediaToken per row (shapeVideo → cust:id),
// so it MUST be scope:"user" — a shared key would serve one user's token to all.
router.get("/free-materials", cacheRoute({ ttl: 86400, entity: "free", scope: "shared" }), listFreeMaterials);
router.get("/free-videos", cacheRoute({ ttl: 86400, entity: "free", scope: "user" }), listFreeVideos);
// "/free-videos/resume" must precede the ":videoId" route so it isn't captured
// as a video id; the heartbeat lives under the same /free-videos prefix. Per-user
// resume + progress writes stay uncached.
router.get("/free-videos/resume", listFreeVideoResume);
router.post("/free-videos/:videoId/progress", reportFreeVideoProgress);
router.get("/free-ebooks", cacheRoute({ ttl: 86400, entity: "free", scope: "user" }), listFreeEbooks);
router.get("/free-courses", cacheRoute({ ttl: 86400, entity: "free", scope: "user" }), listFreeCourses);

export default router;
