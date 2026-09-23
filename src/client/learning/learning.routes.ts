import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  reportLiveSessionProgress,
  listMyLearningProgress,
} from "./progress.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Unified Resume-Learning feed across Course / Package / Live Course.
router.get("/progress/my", listMyLearningProgress);

// Live-session playback heartbeat (mirror of the video heartbeat at
// /courses/lectures/:videoId/progress, but for raw live-session recordings).
router.post(
  "/progress/live-sessions/:liveSessionId",
  reportLiveSessionProgress
);

export default router;
