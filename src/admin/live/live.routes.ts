import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  createLiveSession,
  listLiveSessions,
  getLiveSessionStatus,
  startScheduledLiveSession,
  updateScheduledLiveSession,
  deleteLiveSession,
  endLiveSession,
  promoteSessionRecording,
  getUploadedVideoDetails,
  getOrgDetails,
  updateRecordingWebhook,
} from "./live.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin", "editor"));

// --- Streamos passthrough utilities (defined first so they don't collide
//     with the `:id` patterns below). -----------------------------------------
router.post("/streamos/webhook",                 updateRecordingWebhook);  // POST   /api/v1/admin/live-sessions/streamos/webhook
router.get("/streamos/org",                      getOrgDetails);           // GET    /api/v1/admin/live-sessions/streamos/org
router.get("/streamos/recordings/:recordingId",  getUploadedVideoDetails); // GET    /api/v1/admin/live-sessions/streamos/recordings/:recordingId

// --- Live session CRUD ------------------------------------------------------
router.post("/",          createLiveSession);            // POST   /api/v1/admin/live-sessions
router.get("/",           listLiveSessions);             // GET    /api/v1/admin/live-sessions
router.post("/end",       endLiveSession);               // POST   /api/v1/admin/live-sessions/end
router.post("/:id/start", startScheduledLiveSession);    // POST   /api/v1/admin/live-sessions/:id/start
router.post("/:id/promote-recording", promoteSessionRecording); // POST /api/v1/admin/live-sessions/:id/promote-recording
router.get("/:id",        getLiveSessionStatus);         // GET    /api/v1/admin/live-sessions/:id
router.patch("/:id",      updateScheduledLiveSession);   // PATCH  /api/v1/admin/live-sessions/:id
router.delete("/:id",     deleteLiveSession);            // DELETE /api/v1/admin/live-sessions/:id

export default router;
