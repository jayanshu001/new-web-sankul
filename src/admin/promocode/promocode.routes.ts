import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
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

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
router.get("/plans", getPromocodePlans);
router.get("/", cacheRoute({ ttl: 86400, entity: "promo-code" }), getPromocodes);
router.post("/", autoFlushGroup("promo-code"), createPromocode);
router.post("/bulk-status", autoFlushGroup("promo-code"), bulkStatus);
router.post("/bulk-delete", autoFlushGroup("promo-code"), bulkDelete);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "promo-code" }), getPromocodeById);
router.put("/:id", autoFlushGroup("promo-code"), updatePromocode);
router.delete("/:id", autoFlushGroup("promo-code"), deletePromocode);
router.patch("/:id/status", autoFlushGroup("promo-code"), togglePromocodeStatus);

export default router;
