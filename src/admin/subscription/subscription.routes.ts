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
  listPlansForTarget,
  listCustomerAddresses,
  adminCreateCustomerAddress,
  adminUpdateCustomerAddress,
  adminDeleteCustomerAddress,
} from "./subscription.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Reports
router.get("/reports/summary", reportSummary);
router.get("/reports/by-course", reportByCourse);
router.get("/reports/by-ebook", reportByEbook);
router.get("/reports/book-orders", reportBookOrders);

// Ebook subscriptions (listing)
router.get("/ebook", listEbookSubscriptions);

// Add-Subscription form helpers
router.get("/plans", listPlansForTarget);
router.get("/customer-addresses/:customerId", listCustomerAddresses);
router.post("/customer-addresses", adminCreateCustomerAddress);
router.put("/customer-addresses/:id", adminUpdateCustomerAddress);
router.delete("/customer-addresses/:id", adminDeleteCustomerAddress);

// Course/package subscriptions CRUD
router.get("/", listCourseSubscriptions);
router.post("/", createCourseSubscription);
router.get("/:id", getCourseSubscriptionById);
router.put("/:id", updateCourseSubscription);
router.delete("/:id", deleteCourseSubscription);

export default router;
