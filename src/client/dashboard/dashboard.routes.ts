import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getDashboard,
  getFreeDashboard,
  getResumeDashboard,
} from "./dashboard.controller";

const router = Router();

router.use(authenticate);
router.get("/dashboard", getDashboard);
router.get("/dashboard/resume", getResumeDashboard);
router.get("/free-dashboard", getFreeDashboard);

export default router;
