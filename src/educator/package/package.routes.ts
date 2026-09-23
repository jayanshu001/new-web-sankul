import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listMyPackages,
  getMyPackageDetail,
  getPackageDashboard,
  getPackageSubscribers,
} from "./package.controller";

const router = Router();

router.use(authenticate, requireRole("educator"));

router.get("/", listMyPackages);
router.get("/:id", getMyPackageDetail);
router.get("/:id/dashboard", getPackageDashboard);
router.get("/:id/subscribers", getPackageSubscribers);

export default router;
