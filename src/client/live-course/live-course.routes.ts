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
} from "./live-course.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.get("/",                     listLiveCoursesForClient);     // GET /api/v1/client/live-courses
router.get("/my",                   listMyLiveCourses);            // GET /api/v1/client/live-courses/my
router.get("/:id",                  getLiveCourseForClient);       // GET /api/v1/client/live-courses/:id
router.get("/:id/sessions",            listSessionsForCourseClient);       // GET /api/v1/client/live-courses/:id/sessions
router.get("/:id/recordings",          listLiveCourseRecordings);          // GET /api/v1/client/live-courses/:id/recordings  (folder videos)
router.get("/:id/session-recordings",  listLiveCourseSessionRecordings);   // GET /api/v1/client/live-courses/:id/session-recordings  (raw Streamos recordings)
router.get("/:id/schedule",            getLiveCourseSchedule);             // GET /api/v1/client/live-courses/:id/schedule  (timetable + files)
router.get("/:id/lecture/:videoId",    getLiveCourseLecture);              // GET /api/v1/client/live-courses/:id/lecture/:videoId

export default router;
