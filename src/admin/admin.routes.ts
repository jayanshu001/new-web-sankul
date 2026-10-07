// Admin API: master router (auth, staff gate, RBAC) mounting every admin domain.
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
import adminPlanPopularityRoutes from "./plan-popularity/plan-popularity.routes";
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
import adminExportsRoutes from "./exports/exports.routes";
import adminCacheRoutes from "./cache/cache.routes";
import adminJobsRoutes from "./jobs/jobs.routes";
import adminCareersRoutes from "./careers/careers.routes";
import adminRankPredictorRoutes from "./rank-predictor/rank-predictor.routes";
import authenticate, { requireRole } from "../middlewares/authenticate";
import { enforceRbac } from "../middlewares/rbacEnforce";
import { adminLimiter } from "../config/rateLimiter";

const router = Router();

// /auth (login/refresh) is mounted BEFORE the master `authenticate` so those
// stay public; the auth router applies `authenticate` to its own protected
// endpoints. Every router mounted after `router.use(authenticate, ...)` is
// guaranteed to require a Bearer token, so a new router cannot forget it.
router.use("/auth", adminAuthRoutes);

router.use(authenticate, adminLimiter);

// Admin-surface boundary only (rejects customer/promoter/educator tokens);
// per-permission authorization is handled by enforceRbac below.
router.use(requireRole("admin", "super_admin", "editor"));

// Per-endpoint RBAC. Must run after authenticate (needs req.user). Shadow mode
// (log-only) unless RBAC_ENFORCE=true; super-admins bypass.
router.use(enforceRbac);

router.use("/administrators", adminAdministratorRoutes);
router.use("/roles", adminRoleRoutes);
router.use("/permissions", adminPermissionRoutes);
router.use("/permission-categories", adminPermissionCategoryRoutes);
router.use("/guards", adminGuardsRoutes);
router.use("/video-categories", adminVideoCategoryRoutes);
router.use("/videos", adminVideoRoutes);
router.use("/goals", adminGoalRoutes);
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
router.use("/pc-materials", adminPcMaterialRoutes);
router.use("/plans", adminPlanRoutes);
router.use("/plan-popularity", adminPlanPopularityRoutes);
router.use("/promocodes", adminPromocodeRoutes);
router.use("/subscriptions", adminSubscriptionRoutes);
router.use("/cms", adminCmsRoutes);
router.use("/", adminInquiryRoutes); // serves /inquiries and /departments
router.use("/notifications", adminNotificationRoutes);
router.use("/offline", adminOfflineRoutes);
router.use("/promoters", adminPromoterRoutes);
router.use("/dashboard", adminDashboardRoutes);
router.use("/tracking", adminTrackingRoutes);
router.use("/address", adminAddressRoutes);
router.use("/exam-countdowns", adminExamCountdownRoutes);
router.use("/live-polls", adminLivePollRoutes);
router.use("/live-chat",  adminLiveChatRoutes);
router.use("/live-sessions", adminLiveSessionRoutes);
router.use("/live-courses",  adminLiveCourseRoutes);
router.use("/test-series",   adminTestSeriesRoutes);
router.use("/uploads",       adminUploadsRoutes);
router.use("/exports",       adminExportsRoutes);
router.use("/cache",         adminCacheRoutes);
router.use("/jobs",          adminJobsRoutes);
router.use("/careers",       adminCareersRoutes);
router.use("/rank-predictor", adminRankPredictorRoutes);

export default router;
