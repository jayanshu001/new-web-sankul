import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
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

router.get("/", listPlans);
router.post("/", createPlan);
router.post("/bulk-status", bulkStatus);
router.post("/bulk-delete", bulkDelete);
router.get("/:id", getPlanById);
router.put("/:id", updatePlan);
router.delete("/:id", deletePlan);
router.patch("/:id/status", togglePlanStatus);
router.patch("/:id/default", markAsDefault);
router.post("/:id/clone", clonePlan);

export default router;
