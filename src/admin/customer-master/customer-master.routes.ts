import { Router } from "express";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import { CacheEntity } from "../../middlewares/flushGroups";
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
router.post("/districts", autoFlushGroup(CacheEntity.CustomerLookup), createDistrict);
router.put("/districts/:id", autoFlushGroup(CacheEntity.CustomerLookup), updateDistrict);
router.delete("/districts/:id", autoFlushGroup(CacheEntity.CustomerLookup), deleteDistrict);

// Educations
router.get("/educations", getEducations);
router.post("/educations", autoFlushGroup(CacheEntity.CustomerLookup), createEducation);
router.put("/educations/:id", autoFlushGroup(CacheEntity.CustomerLookup), updateEducation);
router.delete("/educations/:id", autoFlushGroup(CacheEntity.CustomerLookup), deleteEducation);

// Target Goals
router.get("/target-goals", getTargetGoals);
router.post("/target-goals", autoFlushGroup(CacheEntity.Goal), createTargetGoal);
router.put("/target-goals/:id", autoFlushGroup(CacheEntity.Goal), updateTargetGoal);
router.delete("/target-goals/:id", autoFlushGroup(CacheEntity.Goal), deleteTargetGoal);

export default router;
