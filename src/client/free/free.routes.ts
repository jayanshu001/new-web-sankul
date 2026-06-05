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

const router = Router();

router.use(authenticate);

router.get("/free-tests", listFreeTests);
router.get("/free-materials", listFreeMaterials);
router.get("/free-videos", listFreeVideos);
// "/free-videos/resume" must precede the ":videoId" route so it isn't captured
// as a video id; the heartbeat lives under the same /free-videos prefix.
router.get("/free-videos/resume", listFreeVideoResume);
router.post("/free-videos/:videoId/progress", reportFreeVideoProgress);
router.get("/free-ebooks", listFreeEbooks);
router.get("/free-courses", listFreeCourses);

export default router;
