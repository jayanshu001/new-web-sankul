import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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
  getCustomerDetails,
} from "./customer.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/pre-requisites", getCustomerPreRequisites);
router.get("/states/:stateId/districts", getDistrictsByState);

router.get("/", getCustomers);
router.post("/", uploadS3.single("profilePicture"), createCustomer);
router.get("/:id", getCustomerById);
router.get("/:id/details", getCustomerDetails);
router.put("/:id", uploadS3.single("profilePicture"), updateCustomer);
router.delete("/:id", deleteCustomer);
router.patch("/:id/status", toggleCustomerStatus);

router.get("/:id/addresses", getCustomerAddresses);
router.get("/:id/course-subscriptions", getCustomerCourseSubscriptions);
router.put("/:id/course-subscriptions/:subscriptionId", updateCourseSubscriptionDates);
router.get("/:id/ebook-subscriptions", getCustomerEbookSubscriptions);

export default router;
