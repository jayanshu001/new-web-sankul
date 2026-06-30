import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { pinMostPopular, recomputeMostPopular } from "./plan-popularity.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.post("/pin", pinMostPopular);            // POST /api/v1/admin/plan-popularity/pin
router.post("/recompute", recomputeMostPopular); // POST /api/v1/admin/plan-popularity/recompute

export default router;
