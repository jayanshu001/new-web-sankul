import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  listPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  togglePlanStatus,
  markAsDefault,
  bulkStatus,
  bulkDelete,
  clonePlan,
} from "./plan.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Plans are embedded in every product response, so "plan" fans out to
// catalog-package/course/ebook + dashboard + free (flushGroups.ts).
router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Plan }), listPlans);
router.post("/", autoFlushGroup(CacheEntity.Plan), createPlan);
router.post("/bulk-status", autoFlushGroup(CacheEntity.Plan), bulkStatus);
router.post("/bulk-delete", autoFlushGroup(CacheEntity.Plan), bulkDelete);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Plan }), getPlanById);
router.put("/:id", autoFlushGroup(CacheEntity.Plan), updatePlan);
router.delete("/:id", autoFlushGroup(CacheEntity.Plan), deletePlan);
router.patch("/:id/status", autoFlushGroup(CacheEntity.Plan), togglePlanStatus);
router.patch("/:id/default", autoFlushGroup(CacheEntity.Plan), markAsDefault);
router.post("/:id/clone", autoFlushGroup(CacheEntity.Plan), clonePlan);

export default router;
