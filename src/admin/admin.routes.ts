import { Router } from "express";
import adminAuthRoutes from "./auth/admin.auth.routes";
import adminAdministratorRoutes from "./administrator/administrator.routes";
import adminRoleRoutes from "./role/role.routes";
import adminPermissionRoutes from "./permission/permission.routes";
import adminPermissionCategoryRoutes from "./permissionCategory/permissionCategory.routes";
import adminGuardsRoutes from "./guards/guards.routes";
import adminVideoCategoryRoutes from "./videoCategory/videoCategory.routes";
import adminVideoRoutes from "./video/video.routes";
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
import adminPcMaterialRoutes from "./pc-material/pc-material.routes";
import adminPlanRoutes from "./plan/plan.routes";
import adminPromocodeRoutes from "./promocode/promocode.routes";
import adminSubscriptionRoutes from "./subscription/subscription.routes";
import adminCmsRoutes from "./cms/cms.routes";
import adminInquiryRoutes from "./inquiry/inquiry.routes";
import adminNotificationRoutes from "./notification/notification.routes";
import adminOfflineRoutes from "./offline/offline.routes";
import adminPromoterRoutes from "./promoter/promoter.routes";
import adminDashboardRoutes from "./dashboard/dashboard.routes";
import adminTrackingRoutes from "./tracking/tracking.routes";
import adminAddressRoutes from "./address/admin.address.routes";
import adminExamCountdownRoutes from "./examCountdown/examCountdown.routes";
import adminLivePollRoutes from "./livepoll/livepoll.routes";
import adminLiveChatRoutes from "./livechat/livechat.routes";
import adminLiveSessionRoutes from "./live/live.routes";
import adminLiveCourseRoutes from "./live-course/live-course.routes";
import adminTestSeriesRoutes from "./testSeries/testSeries.routes";
import adminUploadsRoutes from "./uploads/uploads.routes";
import authenticate from "../middlewares/authenticate";
import { adminLimiter } from "../config/rateLimiter";

const router = Router();

/**
 * ==========================================
 * MASTER ADMIN API ROUTES (/api/v1/admin)
 * ==========================================
 * All traffic originating from the Admin React
 * Dashboard is channeled here.
 *
 * Auth contract:
 *   - /auth/login and /auth/refresh are public by design and live on
 *     adminAuthRoutes, which is mounted BEFORE the master `authenticate`
 *     middleware below. The auth router itself applies `authenticate` to
 *     its protected endpoints (change-password, profile, logout).
 *   - Every other subtree mounted after the `router.use(authenticate, ...)`
 *     line below is guaranteed to require a valid Bearer token. Per-domain
 *     routers still apply `requireRole(...)` for finer authorization, but
 *     this hoist removes the "forgot authenticate on a new router" footgun
 *     called out in the production-readiness audit.
 */

// Public auth endpoints first (login / refresh). The router enforces
// authenticate internally for its protected handlers.
router.use("/auth", adminAuthRoutes); // -> /api/v1/admin/auth/*

// From here on, every admin route requires a valid Bearer token AND is
// metered by the admin-tier rate limiter (per-admin-id when authenticated).
router.use(authenticate, adminLimiter);

router.use("/administrators", adminAdministratorRoutes); // -> /api/v1/admin/administrators/*
router.use("/roles", adminRoleRoutes); // -> /api/v1/admin/roles/*
router.use("/permissions", adminPermissionRoutes); // -> /api/v1/admin/permissions/*
router.use("/permission-categories", adminPermissionCategoryRoutes); // -> /api/v1/admin/permission-categories/*
router.use("/guards", adminGuardsRoutes); // -> /api/v1/admin/guards
router.use("/video-categories", adminVideoCategoryRoutes); // -> /api/v1/admin/video-categories/*
router.use("/videos", adminVideoRoutes); // -> /api/v1/admin/videos/*
router.use("/goals", adminGoalRoutes); // -> /api/v1/admin/goals/*

// Future Routes (e.g. Roles, Courses, Notifications)
router.use("/courses", adminCourseRoutes);
router.use("/master", adminMasterRoutes);
router.use("/ebooks", adminEbookRoutes);
router.use("/customers", adminCustomerRoutes);
router.use("/customer-masters", adminCustomerMasterRoutes);
router.use("/referrals", adminReferralRoutes);
router.use("/books", adminBookRoutes);
router.use("/quizzes", adminExamRoutes);
router.use("/materials", adminMaterialRoutes);
router.use("/packages", adminPackageRoutes);
router.use("/pc-materials", adminPcMaterialRoutes); // -> /api/v1/admin/pc-materials/*
router.use("/plans", adminPlanRoutes);
router.use("/promocodes", adminPromocodeRoutes);
router.use("/subscriptions", adminSubscriptionRoutes);
router.use("/cms", adminCmsRoutes);
router.use("/", adminInquiryRoutes); // -> /api/v1/admin/{inquiries|departments}
router.use("/notifications", adminNotificationRoutes);
router.use("/offline", adminOfflineRoutes);
router.use("/promoters", adminPromoterRoutes);
router.use("/dashboard", adminDashboardRoutes);
router.use("/tracking", adminTrackingRoutes);
router.use("/address", adminAddressRoutes); // -> /api/v1/admin/address/{states,cities}/*
router.use("/exam-countdowns", adminExamCountdownRoutes); // -> /api/v1/admin/exam-countdowns/*
router.use("/live-polls", adminLivePollRoutes);           // -> /api/v1/admin/live-polls/*
router.use("/live-chat",  adminLiveChatRoutes);           // -> /api/v1/admin/live-chat/*
router.use("/live-sessions", adminLiveSessionRoutes);     // -> /api/v1/admin/live-sessions/*
router.use("/live-courses",  adminLiveCourseRoutes);      // -> /api/v1/admin/live-courses/*
router.use("/test-series",   adminTestSeriesRoutes);      // -> /api/v1/admin/test-series/*
router.use("/uploads",       adminUploadsRoutes);         // -> /api/v1/admin/uploads/* (presigned direct uploads)

export default router;
