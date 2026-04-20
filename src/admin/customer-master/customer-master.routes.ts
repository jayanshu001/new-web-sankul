import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getStates, createState, updateState, deleteState,
  getDistricts, createDistrict, updateDistrict, deleteDistrict,
  getEducations, createEducation, updateEducation, deleteEducation,
  getTargetGoals, createTargetGoal, updateTargetGoal, deleteTargetGoal,
} from "./customer-master.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// States
router.get("/states", getStates);
router.post("/states", createState);
router.put("/states/:id", updateState);
router.delete("/states/:id", deleteState);

// Districts
router.get("/districts", getDistricts);
router.post("/districts", createDistrict);
router.put("/districts/:id", updateDistrict);
router.delete("/districts/:id", deleteDistrict);

// Educations
router.get("/educations", getEducations);
router.post("/educations", createEducation);
router.put("/educations/:id", updateEducation);
router.delete("/educations/:id", deleteEducation);

// Target Goals
router.get("/target-goals", getTargetGoals);
router.post("/target-goals", createTargetGoal);
router.put("/target-goals/:id", updateTargetGoal);
router.delete("/target-goals/:id", deleteTargetGoal);

export default router;
