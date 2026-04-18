import { Router } from "express";
import clientAuthRoutes from "./auth/auth.routes";
import clientProfileRoutes from "./profile/customer.routes";
import clientGoalRoutes from "./goal/goal.client.routes";
import clientCourseRoutes from "./course/course.routes";

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
router.use("/courses", clientCourseRoutes); // -> /api/v1/client/courses/*

// Future Routes (e.g. Exams, Payments)
// router.use("/exams", clientExamRoutes);

export default router;
