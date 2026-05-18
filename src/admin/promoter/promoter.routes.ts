import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  listPromoters,
  getPromoter,
  createPromoter,
  updatePromoter,
  deletePromoter,
  togglePromoterStatus,
  getPromoterPromocodes,
  getPromoterSubscriptions,
  getPromoterDashboard,
} from "./promoter.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/", listPromoters);
router.post("/", uploadS3.single("image"), createPromoter);
router.get("/:id", getPromoter);
router.put("/:id", uploadS3.single("image"), updatePromoter);
router.delete("/:id", deletePromoter);
router.patch("/:id/status", togglePromoterStatus);
router.get("/:id/promocodes", getPromoterPromocodes);
router.get("/:id/subscriptions", getPromoterSubscriptions);
router.get("/:id/dashboard", getPromoterDashboard);

export default router;
