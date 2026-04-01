import { Router } from "express";
import clientAuthRoutes from "./auth/auth.routes";
import clientProfileRoutes from "./profile/customer.routes";
import clientGoalRoutes from "./goal/goal.client.routes";

const router = Router();

/**
 * ==========================================
 * MASTER CLIENT API ROUTES (/api/v1/client)
 * ==========================================
 * All traffic originating from the Mobile App
 * or Student Web Portal is channeled here.
 */

router.use("/auth", clientAuthRoutes); // -> /api/v1/client/auth/*
router.use("/profile", clientProfileRoutes); // -> /api/v1/client/profile/*
router.use("/goals", clientGoalRoutes); // -> /api/v1/client/goals/*

// Future Routes (e.g. Courses, Exams, Payments)
// router.use("/courses", clientCourseRoutes);
// router.use("/exams", clientExamRoutes);

export default router;
