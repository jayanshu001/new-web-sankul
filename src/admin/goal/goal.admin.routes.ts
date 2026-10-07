// Admin goals: goal CRUD routes (cached reads, flushing writes).
import { Router } from "express";
import {
  createGoalHandler,
  getGoalsHandler,
  getGoalByIdHandler,
  updateGoalHandler,
  deleteGoalHandler,
} from "./goal.admin.controller";
import authenticate from "../../middlewares/authenticate";
import { uploadS3, uploadTo } from "../../middlewares/upload";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import { autoFlushGroup } from "../../middlewares/autoFlush";

const router = Router();

// Authorization is catalog RBAC (enforceRbac maps these to goals.view/create/edit/
// delete) + the admin-router staff gate, NOT a hardcoded requireRole, so a role
// granted the goals.* permission authorizes the matching endpoint.

// Cache goal reads; every write flushes "goal" (+ the client caches embedding it).
router.post("/", authenticate, uploadTo(UPLOAD_FOLDERS.goals), uploadS3.single("image"), autoFlushGroup(CacheEntity.Goal), createGoalHandler);

router.get("/", authenticate, cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Goal }), getGoalsHandler);

router.get("/:id", authenticate, cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Goal }), getGoalByIdHandler);

router.put("/:id", authenticate, uploadTo(UPLOAD_FOLDERS.goals), uploadS3.single("image"), autoFlushGroup(CacheEntity.Goal), updateGoalHandler);

router.delete("/:id", authenticate, autoFlushGroup(CacheEntity.Goal), deleteGoalHandler);

export default router;
