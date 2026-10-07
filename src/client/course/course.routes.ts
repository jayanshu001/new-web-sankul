// Client courses: catalog, detail, lecture, progress, shipping and order routes.
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

router.use(authenticate, requireRole("customer"));

// List / category-courses / detail cache shared data internally (cache.aside) and keep
// isPurchased/daysLeft live. Don't wrap them in cacheRoute({ scope: CacheScope.User }):
// it would freeze those per-user fields for the route's TTL.
router.get("/", listCoursesHandler);
router.get("/lecture", getLectureHandler);
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogCourse, scope: CacheScope.Shared }), listCourseCategoriesHandler);
router.get("/categories/:categoryId/courses", listCoursesByCategoryHandler);
router.post("/shipping", addCourseOrderShippingHandler);
router.get("/orders/:id/invoice", getOrderInvoiceHandler);
router.get("/orders/:id", getOrderDetailsHandler);

router.get("/my", listMyCoursesForResume);
router.post("/lectures/:videoId/progress", reportLectureProgress);

router.get("/:id", getCourseByIdHandler);

export default router;
