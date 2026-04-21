import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  listPromoters,
  getPromoter,
  createPromoter,
  updatePromoter,
  deletePromoter,
  togglePromoterStatus,
  getPromoterPromocodes,
  getPromoterSubscriptions,
} from "./promoter.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/", listPromoters);
router.post("/", createPromoter);
router.get("/:id", getPromoter);
router.put("/:id", updatePromoter);
router.delete("/:id", deletePromoter);
router.patch("/:id/status", togglePromoterStatus);
router.get("/:id/promocodes", getPromoterPromocodes);
router.get("/:id/subscriptions", getPromoterSubscriptions);

export default router;
