import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listLiveCoursesForClient,
  getLiveCourseForClient,
  listSessionsForCourseClient,
  listLiveCourseRecordings,
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

router.get("/",                     listLiveCoursesForClient);     // GET /api/v1/client/live-courses
router.get("/my",                   listMyLiveCourses);            // GET /api/v1/client/live-courses/my
router.get("/my/schedule",          listMyScheduleByCategory);     // GET /api/v1/client/live-courses/my/schedule  (home-screen schedule list, grouped by category)
router.get("/my/upcoming-sessions", listMyUpcomingSessions);       // GET /api/v1/client/live-courses/my/upcoming-sessions
router.get("/upcoming-sessions",    listAllUpcomingSessions);      // GET /api/v1/client/live-courses/upcoming-sessions  (global discovery feed)
router.get("/live-now-sessions",    listLiveNowSessions);          // GET /api/v1/client/live-courses/live-now-sessions  (currently-live across all courses)
router.get("/:id",                  getLiveCourseForClient);       // GET /api/v1/client/live-courses/:id
router.get("/:id/sessions",            listSessionsForCourseClient);       // GET /api/v1/client/live-courses/:id/sessions
router.get("/:id/recordings",          listLiveCourseRecordings);          // GET /api/v1/client/live-courses/:id/recordings  (folder videos)
router.get("/:id/session-recordings",  listLiveCourseSessionRecordings);   // GET /api/v1/client/live-courses/:id/session-recordings  (raw Streamos recordings)
router.get("/:id/schedule",                       getLiveCourseSchedule);   // GET /api/v1/client/live-courses/:id/schedule  (timetable + scheduleFolders)
router.get("/:id/schedule-folders/:folderId",     getMyScheduleFolder);     // GET /api/v1/client/live-courses/:id/schedule-folders/:folderId  (folder detail screen)
router.get("/:id/lecture/:videoId",    getLiveCourseLecture);              // GET /api/v1/client/live-courses/:id/lecture/:videoId

export default router;
