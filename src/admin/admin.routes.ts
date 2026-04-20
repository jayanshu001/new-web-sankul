import { Router } from "express";
import adminAuthRoutes from "./auth/admin.auth.routes";
import adminGoalRoutes from "./goal/goal.admin.routes";
import adminCourseRoutes from "./course/course.routes";
import adminMasterRoutes from "./master/master.routes";
import adminEbookRoutes from "./ebook/ebook.routes";
import adminCustomerRoutes from "./customer/customer.routes";
import adminCustomerMasterRoutes from "./customer-master/customer-master.routes";
import adminReferralRoutes from "./referral/referral.routes";
import adminBookRoutes from "./book/book.routes";
import adminExamRoutes from "./exam/exam.routes";
import adminMaterialRoutes from "./material/material.routes";
import adminPackageRoutes from "./package/package.routes";
import adminPlanRoutes from "./plan/plan.routes";

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
router.use("/courses", adminCourseRoutes);
router.use("/master", adminMasterRoutes);
router.use("/ebooks", adminEbookRoutes);
router.use("/customers", adminCustomerRoutes);
router.use("/customer-masters", adminCustomerMasterRoutes);
router.use("/referrals", adminReferralRoutes);
router.use("/books", adminBookRoutes);
router.use("/exams", adminExamRoutes);
router.use("/materials", adminMaterialRoutes);
router.use("/packages", adminPackageRoutes);
router.use("/plans", adminPlanRoutes);

export default router;
