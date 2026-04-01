import { Router } from "express";
import {
  createGoalHandler,
  getGoalsHandler,
  updateGoalHandler,
  deleteGoalHandler,
} from "./goal.admin.controller";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";

const router = Router();

/**
 * GOAL MANAGEMENT ROUTES (Admin)
 * Base Path: /api/v1/admin/goals
 */

// Create a new goal (supports multipart/form-data for image)
router.post(
  "/",
  authenticate,
  requireRole("super_admin"),
  uploadS3.single("image"),
  createGoalHandler
);

// Read all goals natively built for dashboard
router.get("/", authenticate, requireRole("super_admin"), getGoalsHandler);

// Update specific goal
router.put(
  "/:id",
  authenticate,
  requireRole("super_admin"),
  uploadS3.single("image"),
  updateGoalHandler
);

// Delete goal
router.delete("/:id", authenticate, requireRole("super_admin"), deleteGoalHandler);

export default router;
