// Client learning: resume feed and live-session progress routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  reportLiveSessionProgress,
  listMyLearningProgress,
} from "./progress.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.get("/progress/my", listMyLearningProgress);

// Live-session counterpart of /courses/lectures/:videoId/progress.
router.post(
  "/progress/live-sessions/:liveSessionId",
  reportLiveSessionProgress
);

export default router;
