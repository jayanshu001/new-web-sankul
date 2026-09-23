import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { listMyCustomers, getMyCustomerDetail } from "./customer.controller";

const router = Router();
router.use(authenticate, requireRole("promoter"));
router.get("/", listMyCustomers);
router.get("/:id", getMyCustomerDetail);

export default router;
