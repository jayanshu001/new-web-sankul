import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getPromocodes,
  getPromocodeById,
  createPromocode,
  updatePromocode,
  deletePromocode,
  togglePromocodeStatus,
  bulkStatus,
  bulkDelete,
  getPromocodePlans,
} from "./promocode.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

router.get("/plans", getPromocodePlans);
router.get("/", getPromocodes);
router.post("/", createPromocode);
router.post("/bulk-status", bulkStatus);
router.post("/bulk-delete", bulkDelete);
router.get("/:id", getPromocodeById);
router.put("/:id", updatePromocode);
router.delete("/:id", deletePromocode);
router.patch("/:id/status", togglePromocodeStatus);

export default router;
