// Admin subscriptions: course/package grants, reports, exports, plans and customer address routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listCourseSubscriptions,
  getCourseSubscriptionById,
  createCourseSubscription,
  updateCourseSubscription,
  deleteCourseSubscription,
  listEbookSubscriptions,
  exportCourseSubscriptionsCsv,
  exportCourseSubscriptionsExcel,
  reportSummary,
  reportByCourse,
  reportByEbook,
  reportBookOrders,
  listPlansForTarget,
  listCustomerAddresses,
  adminCreateCustomerAddress,
  adminUpdateCustomerAddress,
  adminDeleteCustomerAddress,
  changeSubscriptionProduct,
  moveSubscription,
  deactivateSubscription,
  addSubscriptionDays,
  revertSubscriptionDeactivation,
  getSubscriptionHistory,
} from "./subscription.controller";
import { validate } from "../../middlewares/validate";
import {
  subscriptionIdParamsSchema,
  changeSubscriptionProductSchema,
  moveSubscriptionSchema,
  deactivateSubscriptionSchema,
  addDaysSchema,
  revertDeactivationSchema,
} from "./subscription.validation";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.get("/reports/summary", reportSummary);
router.get("/reports/by-course", reportByCourse);
router.get("/reports/by-ebook", reportByEbook);
router.get("/reports/book-orders", reportBookOrders);

// Two segments, so these match before the single-segment "/:id" route below.
router.get("/export/csv", exportCourseSubscriptionsCsv);
router.get("/export/excel", exportCourseSubscriptionsExcel);

router.get("/ebook", listEbookSubscriptions);

router.get("/plans", listPlansForTarget);
router.get("/customer-addresses/:customerId", listCustomerAddresses);
router.post("/customer-addresses", adminCreateCustomerAddress);
router.put("/customer-addresses/:id", adminUpdateCustomerAddress);
router.delete("/customer-addresses/:id", adminDeleteCustomerAddress);

router.get("/:id/history", validate({ params: subscriptionIdParamsSchema }), getSubscriptionHistory);
router.post(
  "/:id/change-product",
  validate({ params: subscriptionIdParamsSchema, body: changeSubscriptionProductSchema }),
  changeSubscriptionProduct
);
router.post(
  "/:id/move",
  validate({ params: subscriptionIdParamsSchema, body: moveSubscriptionSchema }),
  moveSubscription
);
router.post(
  "/:id/deactivate",
  validate({ params: subscriptionIdParamsSchema, body: deactivateSubscriptionSchema }),
  deactivateSubscription
);
router.post(
  "/:id/add-days",
  validate({ params: subscriptionIdParamsSchema, body: addDaysSchema }),
  addSubscriptionDays
);
router.post(
  "/:id/revert-deactivation",
  validate({ params: subscriptionIdParamsSchema, body: revertDeactivationSchema }),
  revertSubscriptionDeactivation
);

// Course/package subscriptions CRUD
router.get("/", listCourseSubscriptions);
router.post("/", createCourseSubscription);
router.get("/:id", getCourseSubscriptionById);
router.put("/:id", updateCourseSubscription);
router.delete("/:id", deleteCourseSubscription);

export default router;
