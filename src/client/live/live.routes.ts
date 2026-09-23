import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import validate from "../../middlewares/validate";
import { getLiveSessionForClient, livePreviewHeartbeat, livePreviewStop } from "./live.controller";
import {
  getLiveSessionQuerySchema,
  previewHeartbeatBodySchema,
  previewStopBodySchema,
  previewTrackingQuerySchema,
} from "./live.validation";

const router = Router();

router.use(authenticate, requireRole("customer"));

// GET /api/v1/client/live-sessions/:id  (id = sessionId or streamId)
// ?liveCourseId= scopes entitlement to that course; omit it for the Live Now
// entry point (any linked course may grant access).
router.get("/:id", validate({ query: getLiveSessionQuerySchema }), getLiveSessionForClient);

// Preview watch-time metering. The 3-minute trial is consumed by these calls and
// by NOTHING else — GET /:id above is read-only, so a student who never plays
// never loses trial time. Both carry the same ?liveCourseId entry point as the
// GET so entitlement is judged identically.
router.post(
  "/:id/preview/heartbeat",
  validate({ query: previewTrackingQuerySchema, body: previewHeartbeatBodySchema }),
  livePreviewHeartbeat
);
router.post(
  "/:id/preview/stop",
  validate({ query: previewTrackingQuerySchema, body: previewStopBodySchema }),
  livePreviewStop
);

export default router;
