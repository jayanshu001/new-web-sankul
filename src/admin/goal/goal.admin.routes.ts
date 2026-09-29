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

/**
 * GOAL MANAGEMENT ROUTES (Admin)
 * Base Path: /api/v1/admin/goals
 *
 * Authorization is via catalog RBAC (enforceRbac maps these to goals.view /
 * goals.create / goals.edit / goals.delete) + the admin-router staff gate — NOT
 * a hardcoded requireRole. A role granted the goals.* catalog permission
 * authorizes the matching endpoint. (Previously gated super_admin-only, which
 * ignored catalog grants — see goals-403-despite-granted-permission.md.)
 */

// Cache goal reads; every write flushes "goal" (+ the client caches embedding it).
// Create a new goal (supports multipart/form-data for image)
router.post("/", authenticate, uploadTo(UPLOAD_FOLDERS.goals), uploadS3.single("image"), autoFlushGroup(CacheEntity.Goal), createGoalHandler);

// Read all goals natively built for dashboard
router.get("/", authenticate, cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Goal }), getGoalsHandler);

// Read a single goal by id (with its labels — for server-searched pickers)
router.get("/:id", authenticate, cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Goal }), getGoalByIdHandler);

// Update specific goal
router.put("/:id", authenticate, uploadTo(UPLOAD_FOLDERS.goals), uploadS3.single("image"), autoFlushGroup(CacheEntity.Goal), updateGoalHandler);

// Delete goal
router.delete("/:id", authenticate, autoFlushGroup(CacheEntity.Goal), deleteGoalHandler);

export default router;
