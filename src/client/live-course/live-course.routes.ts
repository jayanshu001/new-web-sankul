import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import {
  listLiveCoursesForClient,
  listRecentlyAddedLiveCourses,
  listUpcomingLiveBatches,
  getLiveCourseForClient,
  listSessionsForCourseClient,
  listLiveCourseRecordings,
  getLiveCourseRecordingFolder,
  listLiveCourseSessionRecordings,
  getLiveCourseLecture,
  getLiveCourseSchedule,
  listMyLiveCourses,
  listMyScheduleByCategory,
  getMyScheduleFolder,
  listMyUpcomingSessions,
  listAllUpcomingSessions,
  listLiveNowSessions,
} from "./live-course.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

// Discovery feeds + course detail/sessions embed a per-user isPurchased overlay →
// Tier-2, cached per-user + short TTL (ebook precedent), entity:"live-course"
// (admin live-course writes flush it). NOT cached: /live-now-sessions (live state),
// /my* (per-user schedule), recordings + lecture (per-request media tokens),
// /:id/schedule* (per-user timetable).
const LC = { ttl: 86400, entity: "live-course" as const, scope: "user" as const };
router.get("/",                     cacheRoute(LC), listLiveCoursesForClient);     // GET /api/v1/client/live-courses
router.get("/recently-added",       cacheRoute(LC), listRecentlyAddedLiveCourses); // GET /api/v1/client/live-courses/recently-added  (newest-first feed)
router.get("/upcoming-batches",     cacheRoute(LC), listUpcomingLiveBatches);      // GET /api/v1/client/live-courses/upcoming-batches  (home carousel + category tab bar)
router.get("/my",                   listMyLiveCourses);            // GET /api/v1/client/live-courses/my
router.get("/my/schedule",          listMyScheduleByCategory);     // GET /api/v1/client/live-courses/my/schedule  (home-screen schedule list, grouped by category)
router.get("/my/upcoming-sessions", listMyUpcomingSessions);       // GET /api/v1/client/live-courses/my/upcoming-sessions
router.get("/upcoming-sessions",    cacheRoute(LC), listAllUpcomingSessions);      // GET /api/v1/client/live-courses/upcoming-sessions  (global discovery feed)
router.get("/live-now-sessions",    listLiveNowSessions);          // GET /api/v1/client/live-courses/live-now-sessions  (currently-live across all courses)
router.get("/:id",                  cacheRoute(LC), getLiveCourseForClient);       // GET /api/v1/client/live-courses/:id
router.get("/:id/sessions",            cacheRoute(LC), listSessionsForCourseClient);       // GET /api/v1/client/live-courses/:id/sessions
router.get("/:id/recordings",          listLiveCourseRecordings);          // GET /api/v1/client/live-courses/:id/recordings  (folder videos; ?summary=1 → folder rows + lectureCount, no lectures[])
router.get("/:id/recordings/:folderId", getLiveCourseRecordingFolder);     // GET /api/v1/client/live-courses/:id/recordings/:folderId  (one folder's lectures, paginated by lecture)
router.get("/:id/session-recordings",  listLiveCourseSessionRecordings);   // GET /api/v1/client/live-courses/:id/session-recordings  (raw Streamos recordings)
router.get("/:id/schedule",                       getLiveCourseSchedule);   // GET /api/v1/client/live-courses/:id/schedule  (timetable + scheduleFolders)
router.get("/:id/schedule-folders/:folderId",     getMyScheduleFolder);     // GET /api/v1/client/live-courses/:id/schedule-folders/:folderId  (folder detail screen)
router.get("/:id/lecture/:videoId",    getLiveCourseLecture);              // GET /api/v1/client/live-courses/:id/lecture/:videoId

export default router;
