import { Router } from "express";
import promoterAuthRoutes from "./auth/promoter.auth.routes";
import promoterDashboardRoutes from "./dashboard/dashboard.routes";
import promoterPromocodeRoutes from "./promocode/promocode.routes";
import promoterCustomerRoutes from "./customer/customer.routes";
import promoterSubscriptionRoutes from "./subscription/subscription.routes";

const router = Router();

/**
 * ==========================================
 * PROMOTER API ROUTES (/api/v1/promoter)
 * ==========================================
 * Separate auth domain for promoters. Login via email/password.
 */

router.use("/auth", promoterAuthRoutes);
router.use("/dashboard", promoterDashboardRoutes);
router.use("/promocodes", promoterPromocodeRoutes);
router.use("/customers", promoterCustomerRoutes);
router.use("/subscriptions", promoterSubscriptionRoutes);

export default router;
