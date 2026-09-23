import { Router } from "express";
import educatorAuthRoutes from "./auth/educator.auth.routes";
import educatorCourseRoutes from "./course/course.routes";
import educatorPackageRoutes from "./package/package.routes";
import educatorDashboardRoutes from "./dashboard/dashboard.routes";

const router = Router();

/**
 * ==========================================
 * EDUCATOR API ROUTES (/api/v1/educator)
 * ==========================================
 * Separate auth domain for educators. Login via email/password.
 */

router.use("/auth", educatorAuthRoutes);
router.use("/courses", educatorCourseRoutes);
router.use("/packages", educatorPackageRoutes);
router.use("/dashboard", educatorDashboardRoutes);

export default router;
