// Admin customer masters: district, education and target-goal lookup routes.
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

router.get("/districts", getDistricts);
// districts + educations feed the cached client/address lookups. target-goals
// write the same table as admin/goal, so they flush the "goal" group too.
router.post("/districts", autoFlushGroup(CacheEntity.CustomerLookup), createDistrict);
router.put("/districts/:id", autoFlushGroup(CacheEntity.CustomerLookup), updateDistrict);
router.delete("/districts/:id", autoFlushGroup(CacheEntity.CustomerLookup), deleteDistrict);

router.get("/educations", getEducations);
router.post("/educations", autoFlushGroup(CacheEntity.CustomerLookup), createEducation);
router.put("/educations/:id", autoFlushGroup(CacheEntity.CustomerLookup), updateEducation);
router.delete("/educations/:id", autoFlushGroup(CacheEntity.CustomerLookup), deleteEducation);

router.get("/target-goals", getTargetGoals);
router.post("/target-goals", autoFlushGroup(CacheEntity.Goal), createTargetGoal);
router.put("/target-goals/:id", autoFlushGroup(CacheEntity.Goal), updateTargetGoal);
router.delete("/target-goals/:id", autoFlushGroup(CacheEntity.Goal), deleteTargetGoal);

export default router;
