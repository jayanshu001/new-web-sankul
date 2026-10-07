// Educator surface: master router (separate auth domain, email/password login).
import { Router } from "express";
import educatorAuthRoutes from "./auth/educator.auth.routes";
import educatorCourseRoutes from "./course/course.routes";
import educatorPackageRoutes from "./package/package.routes";
import educatorDashboardRoutes from "./dashboard/dashboard.routes";

const router = Router();

router.use("/auth", educatorAuthRoutes);
router.use("/courses", educatorCourseRoutes);
router.use("/packages", educatorPackageRoutes);
router.use("/dashboard", educatorDashboardRoutes);

export default router;
