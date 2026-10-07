// Client live courses: catalog, recordings, schedule and session-feed routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import {
  listLiveCoursesForClient,
  listRecentlyAddedLiveCourses,
  listUpcomingLiveBatches,
  getLiveCourseForClient,
  listSessionsForCourseClient,
  listLiveCourseRecordings,
  getLiveCourseRecordingFolder,
  listLiveCourseRecordingFolderChildren,
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

// Feeds and detail embed a per-user isPurchased overlay, so they are cached per user
// (admin live-course writes flush it). Not cached: live-now (live state), /my* and
// /:id/schedule* (per-user), recordings + lecture (per-request media tokens).
const LC = { ttl: CACHE_TTL.DAY, entity: CacheEntity.LiveCourse as const, scope: CacheScope.User as const };
router.get("/",                     cacheRoute(LC), listLiveCoursesForClient);
router.get("/recently-added",       cacheRoute(LC), listRecentlyAddedLiveCourses); // newest-first feed
router.get("/upcoming-batches",     cacheRoute(LC), listUpcomingLiveBatches); // home carousel + category tab bar
router.get("/my",                   listMyLiveCourses);
router.get("/my/schedule",          listMyScheduleByCategory); // home-screen schedule list, grouped by category
router.get("/my/upcoming-sessions", listMyUpcomingSessions);
router.get("/upcoming-sessions",    cacheRoute(LC), listAllUpcomingSessions); // global discovery feed
router.get("/live-now-sessions",    listLiveNowSessions); // currently-live across all courses
router.get("/:id",                  cacheRoute(LC), getLiveCourseForClient);
router.get("/:id/sessions",            cacheRoute(LC), listSessionsForCourseClient);
router.get("/:id/recordings",          listLiveCourseRecordings); // folder videos; ?summary=1 → folder rows + lectureCount, no lectures[]
router.get("/:id/recordings/:folderId", getLiveCourseRecordingFolder); // one folder's lectures, paginated by lecture
router.get("/:id/recordings/:folderId/children", listLiveCourseRecordingFolderChildren); // sub-folders, paginated by folder — mirrors /client/material-categories/:id/children
router.get("/:id/session-recordings",  listLiveCourseSessionRecordings); // raw Streamos recordings
router.get("/:id/schedule",                       getLiveCourseSchedule); // timetable + scheduleFolders
router.get("/:id/schedule-folders/:folderId",     getMyScheduleFolder); // folder detail screen
router.get("/:id/lecture/:videoId",    getLiveCourseLecture);

export default router;
