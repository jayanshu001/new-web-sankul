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

// free-tests embeds per-user attempt stats → Tier-2, deferred (not cached).
router.get("/free-tests", listFreeTests);
// Tier-1: free materials & videos carry no per-user state (free-only content).
router.get("/free-materials", cacheRoute({ ttl: 300, entity: "free", scope: "shared" }), listFreeMaterials);
router.get("/free-videos", cacheRoute({ ttl: 300, entity: "free", scope: "shared" }), listFreeVideos);
// "/free-videos/resume" must precede the ":videoId" route so it isn't captured
// as a video id; the heartbeat lives under the same /free-videos prefix.
router.get("/free-videos/resume", listFreeVideoResume);
router.post("/free-videos/:videoId/progress", reportFreeVideoProgress);
router.get("/free-ebooks", listFreeEbooks);
router.get("/free-courses", listFreeCourses);

export default router;
