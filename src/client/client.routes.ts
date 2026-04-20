import { Router } from "express";
import clientAuthRoutes from "./auth/auth.routes";
import clientProfileRoutes from "./profile/customer.routes";
import clientGoalRoutes from "./goal/goal.client.routes";
import clientCourseRoutes from "./course/course.routes";
import clientAddressRoutes from "./address/address.routes";
import clientReferralRoutes from "./referral/referral.routes";
import clientBookRoutes from "./book/book.routes";
import clientExamRoutes from "./exam/exam.routes";
import clientMaterialRoutes from "./material/material.routes";
import clientPackageRoutes from "./package/package.routes";

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
router.use("/address", clientAddressRoutes); // -> /api/v1/client/address/*
router.use("/referral", clientReferralRoutes); // -> /api/v1/client/referral/*
router.use("/books", clientBookRoutes); // -> /api/v1/client/books/*
router.use("/exams", clientExamRoutes); // -> /api/v1/client/exams/*
router.use("/materials", clientMaterialRoutes); // -> /api/v1/client/materials/*
router.use("/packages", clientPackageRoutes); // -> /api/v1/client/packages/*

// Future Routes (e.g. Exams, Payments)
// router.use("/exams", clientExamRoutes);

export default router;
