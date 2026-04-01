import { Router } from "express";
import adminAuthRoutes from "./auth/admin.auth.routes";
import adminGoalRoutes from "./goal/goal.admin.routes";

const router = Router();

/**
 * ==========================================
 * MASTER ADMIN API ROUTES (/api/v1/admin)
 * ==========================================
 * All traffic originating from the Admin React
 * Dashboard is channeled here.
 */

router.use("/auth", adminAuthRoutes); // -> /api/v1/admin/auth/*
router.use("/goals", adminGoalRoutes); // -> /api/v1/admin/goals/*

// Future Routes (e.g. Roles, Courses, Notifications)
// router.use("/roles", adminRoleRoutes);
// router.use("/courses", adminCourseRoutes);

export default router;
