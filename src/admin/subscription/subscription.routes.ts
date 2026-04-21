import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listCourseSubscriptions,
  getCourseSubscriptionById,
  createCourseSubscription,
  updateCourseSubscription,
  deleteCourseSubscription,
  listEbookSubscriptions,
  reportSummary,
  reportByCourse,
  reportByEbook,
  reportBookOrders,
} from "./subscription.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Reports
router.get("/reports/summary", reportSummary);
router.get("/reports/by-course", reportByCourse);
router.get("/reports/by-ebook", reportByEbook);
router.get("/reports/book-orders", reportBookOrders);

// Ebook subscriptions (listing)
router.get("/ebook", listEbookSubscriptions);

// Course/package subscriptions CRUD
router.get("/", listCourseSubscriptions);
router.post("/", createCourseSubscription);
router.get("/:id", getCourseSubscriptionById);
router.put("/:id", updateCourseSubscription);
router.delete("/:id", deleteCourseSubscription);

export default router;
