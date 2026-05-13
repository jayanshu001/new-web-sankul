import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listLiveCoursesForClient,
  getLiveCourseForClient,
  listSessionsForCourseClient,
} from "./live-course.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.get("/",                listLiveCoursesForClient);     // GET /api/v1/client/live-courses
router.get("/:id",             getLiveCourseForClient);       // GET /api/v1/client/live-courses/:id
router.get("/:id/sessions",    listSessionsForCourseClient);  // GET /api/v1/client/live-courses/:id/sessions

export default router;
