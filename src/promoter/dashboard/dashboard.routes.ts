import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { getDashboard } from "./dashboard.controller";

const router = Router();

router.use(authenticate, requireRole("promoter"));
router.get("/", getDashboard);

export default router;
