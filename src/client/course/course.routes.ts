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
import { cacheRoute } from "../../middlewares/cacheRoute";

const router = Router();

// All course endpoints are authenticated customer routes.
router.use(authenticate, requireRole("customer"));

// Tier-1 (fully shared): course categories carry no per-user state (no
// customerId passed). scope:"shared" → one entry for all clients. The course
// LIST + category-courses + DETAIL embed isPurchased/progress → Tier-2, cached
// per-user + short TTL (ebook precedent), entity:"catalog-course" (admin course
// / live-course writes flush it). /lecture (video tokens) + /my (resume) stay uncached.
router.get("/", cacheRoute({ ttl: 86400, entity: "catalog-course", scope: "user" }), listCoursesHandler);
router.get("/lecture", getLectureHandler);
router.get("/categories", cacheRoute({ ttl: 86400, entity: "catalog-course", scope: "shared" }), listCourseCategoriesHandler);
router.get("/categories/:categoryId/courses", cacheRoute({ ttl: 86400, entity: "catalog-course", scope: "user" }), listCoursesByCategoryHandler);
router.post("/shipping", addCourseOrderShippingHandler);
router.get("/orders/:id/invoice", getOrderInvoiceHandler);
router.get("/orders/:id", getOrderDetailsHandler);

// Resume-Learning screen
router.get("/my", listMyCoursesForResume);
router.post("/lectures/:videoId/progress", reportLectureProgress);

router.get("/:id", cacheRoute({ ttl: 86400, entity: "catalog-course", scope: "user" }), getCourseByIdHandler);

export default router;
