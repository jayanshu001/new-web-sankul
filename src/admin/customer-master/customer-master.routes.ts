import { Router } from "express";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getDistricts, createDistrict, updateDistrict, deleteDistrict,
  getEducations, createEducation, updateEducation, deleteEducation,
  getTargetGoals, createTargetGoal, updateTargetGoal, deleteTargetGoal,
} from "./customer-master.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// States — moved to /api/v1/admin/address/states (see admin/address/admin.address.routes.ts)
// router.get("/states", getStates);
// router.post("/states", createState);
// router.put("/states/:id", updateState);
// router.delete("/states/:id", deleteState);

// Districts
router.get("/districts", getDistricts);
// districts + educations feed the cached client/address lookups.
// target-goals write prisma.customerTargetGoal — the SAME table admin/goal
// writes — so they flush the "goal" group, which fans out to catalog-package,
// client-dashboard and customer-lookup exactly as admin/goal does.
router.post("/districts", autoFlushGroup("customer-lookup"), createDistrict);
router.put("/districts/:id", autoFlushGroup("customer-lookup"), updateDistrict);
router.delete("/districts/:id", autoFlushGroup("customer-lookup"), deleteDistrict);

// Educations
router.get("/educations", getEducations);
router.post("/educations", autoFlushGroup("customer-lookup"), createEducation);
router.put("/educations/:id", autoFlushGroup("customer-lookup"), updateEducation);
router.delete("/educations/:id", autoFlushGroup("customer-lookup"), deleteEducation);

// Target Goals
router.get("/target-goals", getTargetGoals);
router.post("/target-goals", autoFlushGroup("goal"), createTargetGoal);
router.put("/target-goals/:id", autoFlushGroup("goal"), updateTargetGoal);
router.delete("/target-goals/:id", autoFlushGroup("goal"), deleteTargetGoal);

export default router;
