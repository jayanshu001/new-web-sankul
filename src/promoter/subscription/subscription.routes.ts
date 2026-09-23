import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { listMySubscriptions, subscriptionReport } from "./subscription.controller";

const router = Router();
router.use(authenticate, requireRole("promoter"));
router.get("/", listMySubscriptions);
router.get("/report", subscriptionReport);

export default router;
