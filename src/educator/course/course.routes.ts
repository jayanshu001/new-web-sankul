import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listMyCourses,
  getMyCourseDetail,
  getCourseDashboard,
  getCourseSubscribers,
} from "./course.controller";

const router = Router();

router.use(authenticate, requireRole("educator"));

router.get("/", listMyCourses);
router.get("/:id", getMyCourseDetail);
router.get("/:id/dashboard", getCourseDashboard);
router.get("/:id/subscribers", getCourseSubscribers);

export default router;
