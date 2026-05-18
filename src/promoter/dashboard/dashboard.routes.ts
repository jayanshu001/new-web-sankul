import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getDashboard, getDashboardOverview } from "./dashboard.controller";

const router = Router();

router.use(authenticate, requireRole("promoter"));
router.get("/", getDashboard);
router.get("/overview", getDashboardOverview);

export default router;
