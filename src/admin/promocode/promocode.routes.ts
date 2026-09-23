import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PromoCode }), getPromocodes);
router.post("/", autoFlushGroup(CacheEntity.PromoCode), createPromocode);
router.post("/bulk-status", autoFlushGroup(CacheEntity.PromoCode), bulkStatus);
router.post("/bulk-delete", autoFlushGroup(CacheEntity.PromoCode), bulkDelete);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.PromoCode }), getPromocodeById);
router.put("/:id", autoFlushGroup(CacheEntity.PromoCode), updatePromocode);
router.delete("/:id", autoFlushGroup(CacheEntity.PromoCode), deletePromocode);
router.patch("/:id/status", autoFlushGroup(CacheEntity.PromoCode), togglePromocodeStatus);

export default router;
