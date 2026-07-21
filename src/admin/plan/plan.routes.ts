import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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
router.get("/", cacheRoute({ ttl: 86400, entity: "plan" }), listPlans);
router.post("/", autoFlushGroup("plan"), createPlan);
router.post("/bulk-status", autoFlushGroup("plan"), bulkStatus);
router.post("/bulk-delete", autoFlushGroup("plan"), bulkDelete);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "plan" }), getPlanById);
router.put("/:id", autoFlushGroup("plan"), updatePlan);
router.delete("/:id", autoFlushGroup("plan"), deletePlan);
router.patch("/:id/status", autoFlushGroup("plan"), togglePlanStatus);
router.patch("/:id/default", autoFlushGroup("plan"), markAsDefault);
router.post("/:id/clone", autoFlushGroup("plan"), clonePlan);

export default router;
