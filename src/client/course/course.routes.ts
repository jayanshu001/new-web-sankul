import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getCourseByIdHandler,
  addCourseOrderShippingHandler,
  getOrderDetailsHandler,
  getOrderInvoiceHandler,
  listCoursesHandler,
  listCourseCategoriesHandler,
  listCoursesByCategoryHandler,
} from "./course.controller";
import { getLectureHandler } from "./lecture.controller";
import {
  reportLectureProgress,
  listMyCoursesForResume,
} from "./progress.controller";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";

const router = Router();

// All course endpoints are authenticated customer routes.
router.use(authenticate, requireRole("customer"));

// Tier-1 (fully shared): course categories carry no per-user state (no
// customerId passed). scope: CacheScope.Shared → one entry for all clients.
//
// LIST/category-courses/DETAIL cache internally now (listCoursesWithPlans /
// buildCourseDetailsSql use cache.aside — shared data cached, isPurchased/
// daysLeft always live). Don't wrap these in an outer cacheRoute({ scope:
// CacheScope.User }) — it re-freezes those per-user fields for the route's TTL.
router.get("/", listCoursesHandler);
router.get("/lecture", getLectureHandler);
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogCourse, scope: CacheScope.Shared }), listCourseCategoriesHandler);
router.get("/categories/:categoryId/courses", listCoursesByCategoryHandler);
router.post("/shipping", addCourseOrderShippingHandler);
router.get("/orders/:id/invoice", getOrderInvoiceHandler);
router.get("/orders/:id", getOrderDetailsHandler);

// Resume-Learning screen
router.get("/my", listMyCoursesForResume);
router.post("/lectures/:videoId/progress", reportLectureProgress);

router.get("/:id", getCourseByIdHandler);

export default router;
