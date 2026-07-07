import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { pinMostPopular, recomputeMostPopular } from "./plan-popularity.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.post("/pin", pinMostPopular);            // POST /api/v1/admin/plan-popularity/pin
router.post("/recompute", recomputeMostPopular); // POST /api/v1/admin/plan-popularity/recompute

export default router;
