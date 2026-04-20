import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getCustomers,
  getCustomerById,
  getCustomerPreRequisites,
  getDistrictsByState,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  toggleCustomerStatus,
  getCustomerAddresses,
  getCustomerCourseSubscriptions,
  getCustomerEbookSubscriptions,
  updateCourseSubscriptionDates,
} from "./customer.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/pre-requisites", getCustomerPreRequisites);
router.get("/states/:stateId/districts", getDistrictsByState);

router.get("/", getCustomers);
router.post("/", createCustomer);
router.get("/:id", getCustomerById);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);
router.patch("/:id/status", toggleCustomerStatus);

router.get("/:id/addresses", getCustomerAddresses);
router.get("/:id/course-subscriptions", getCustomerCourseSubscriptions);
router.put("/:id/course-subscriptions/:subscriptionId", updateCourseSubscriptionDates);
router.get("/:id/ebook-subscriptions", getCustomerEbookSubscriptions);

export default router;
