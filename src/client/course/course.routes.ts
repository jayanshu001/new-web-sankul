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

const router = Router();

// All course endpoints are authenticated customer routes.
router.use(authenticate, requireRole("customer"));

router.get("/", listCoursesHandler);
router.get("/lecture", getLectureHandler);
router.get("/categories", listCourseCategoriesHandler);
router.get("/categories/:categoryId/courses", listCoursesByCategoryHandler);
router.post("/shipping", addCourseOrderShippingHandler);
router.get("/orders/:id/invoice", getOrderInvoiceHandler);
router.get("/orders/:id", getOrderDetailsHandler);
router.get("/:id", getCourseByIdHandler);

export default router;
