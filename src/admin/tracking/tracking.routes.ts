import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { listActivity, activitySummary } from "./tracking.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/", listActivity);
router.get("/summary", activitySummary);

export default router;
