import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  createLiveSession,
  listLiveSessions,
  getLiveSessionStatus,
  provisionLiveSession,
  startScheduledLiveSession,
  updateScheduledLiveSession,
  deleteLiveSession,
  endLiveSession,
  promoteSessionRecording,
  getLiveSessionAttendance,
  getUploadedVideoDetails,
  getOrgDetails,
  updateRecordingWebhook,
  getRecordingHealth,
} from "./live.controller";

import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// --- Streamos passthrough utilities (defined first so they don't collide
//     with the `:id` patterns below). -----------------------------------------
router.post("/streamos/webhook",                 autoFlushGroup(CacheEntity.LiveCourse), updateRecordingWebhook);  // POST   /api/v1/admin/live-sessions/streamos/webhook
router.get("/streamos/org",                      getOrgDetails);           // GET    /api/v1/admin/live-sessions/streamos/org
router.get("/streamos/recordings/:recordingId",  getUploadedVideoDetails); // GET    /api/v1/admin/live-sessions/streamos/recordings/:recordingId

// Every session write flushes the "live-course" group: three CACHED client reads
// are built from this same live-session data via liveSql —
// GET /client/live-courses/upcoming-sessions, /upcoming-batches and
// /:id/sessions (all 24h TTL). Without this a newly scheduled, started, ended or
// deleted session stayed invisible in the app for up to a day.
// --- Live session CRUD ------------------------------------------------------
router.post("/",          autoFlushGroup(CacheEntity.LiveCourse), createLiveSession);            // POST   /api/v1/admin/live-sessions
router.get("/",           listLiveSessions);             // GET    /api/v1/admin/live-sessions
router.post("/end",       autoFlushGroup(CacheEntity.LiveCourse), endLiveSession);               // POST   /api/v1/admin/live-sessions/end
router.post("/:id/provision", autoFlushGroup(CacheEntity.LiveCourse), provisionLiveSession);     // POST   /api/v1/admin/live-sessions/:id/provision
router.post("/:id/start", autoFlushGroup(CacheEntity.LiveCourse), startScheduledLiveSession);    // POST   /api/v1/admin/live-sessions/:id/start
router.post("/:id/promote-recording", autoFlushGroup(CacheEntity.LiveCourse), promoteSessionRecording); // POST /api/v1/admin/live-sessions/:id/promote-recording
router.get("/:id/attendance", getLiveSessionAttendance);   // GET    /api/v1/admin/live-sessions/:id/attendance
router.get("/:id/recording-health", getRecordingHealth);  // GET    /api/v1/admin/live-sessions/:id/recording-health
router.get("/:id",        getLiveSessionStatus);         // GET    /api/v1/admin/live-sessions/:id
router.patch("/:id",      autoFlushGroup(CacheEntity.LiveCourse), updateScheduledLiveSession);   // PATCH  /api/v1/admin/live-sessions/:id
router.delete("/:id",     autoFlushGroup(CacheEntity.LiveCourse), deleteLiveSession);            // DELETE /api/v1/admin/live-sessions/:id

export default router;
