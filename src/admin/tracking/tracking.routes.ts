import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { listActivity, activitySummary } from "./tracking.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.get("/", listActivity);
router.get("/summary", activitySummary);

export default router;
