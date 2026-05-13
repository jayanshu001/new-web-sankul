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
import clientPromocodeRoutes from "./promocode/promocode.routes";
import clientEbookRoutes from "./ebook/ebook.routes";
import clientOrdersRoutes from "./orders/orders.routes";
import clientCmsRoutes from "./cms/cms.routes";
import clientInquiryRoutes from "./inquiry/inquiry.routes";
import clientNotificationRoutes from "./notification/notification.routes";
import clientDashboardRoutes from "./dashboard/dashboard.routes";
import clientOfflineRoutes from "./offline/offline.routes";
import clientWishlistRoutes from "./wishlist/wishlist.routes";
import clientCartRoutes from "./cart/cart.routes";
import clientPaymentRoutes from "./payment/payment.routes";
import clientPurchaseHistoryRoutes from "./purchase-history/purchase-history.routes";
import clientMySubscriptionsRoutes from "./my-subscriptions/my-subscriptions.routes";
import clientWebhookRoutes from "./webhook/webhook.routes";
import clientTrackingRoutes from "./tracking/tracking.routes";
import clientSaveRoutes from "./save/save.routes";
import clientFreeRoutes from "./free/free.routes";
import clientCategoriesRoutes from "./categories/categories.routes";
import { videoFolderRouter, materialFolderRouter } from "./folder/folder.routes";
import clientExamCountdownRoutes from "./examCountdown/examCountdown.routes";
import clientEducatorRoutes from "./educator/educator.routes";
import { youtubeStreamProxy } from "./categories/yt-proxy.controller";
import clientLiveChatRoutes from "./livechat/livechat.routes";
import clientLivePollRoutes from "./livepoll/livepoll.routes";
import clientSearchRoutes from "./search/search.routes";
import clientLiveSessionRoutes from "./live/live.routes";
import clientLiveCourseRoutes from "./live-course/live-course.routes";

const router = Router();

// Public: HMAC token in the URL is the auth (short-lived, scoped to one
// youtube_id+itag). Native players can't send Bearer headers, so this route
// must be registered BEFORE any sub-router that applies `authenticate`.
router.get("/yt-proxy", youtubeStreamProxy);

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
router.use("/quizzes", clientExamRoutes); // -> /api/v1/client/quizzes/*
router.use("/materials", clientMaterialRoutes); // -> /api/v1/client/materials/*
router.use("/packages", clientPackageRoutes); // -> /api/v1/client/packages/*
router.use("/promocodes", clientPromocodeRoutes); // -> /api/v1/client/promocodes/*
router.use("/ebooks", clientEbookRoutes); // -> /api/v1/client/ebooks/*
router.use("/orders", clientOrdersRoutes); // -> /api/v1/client/orders/*
router.use("/", clientCmsRoutes); // -> /api/v1/client/{faqs|popup|banners|testimonials|terms|version|upgrade}
router.use("/", clientInquiryRoutes); // -> /api/v1/client/{inquiry|contactus}
router.use("/", clientNotificationRoutes); // -> /api/v1/client/{notifications|image-notifications}
router.use("/", clientDashboardRoutes); // -> /api/v1/client/{dashboard|free-dashboard}
router.use("/", clientFreeRoutes); // -> /api/v1/client/{free-tests|free-materials|free-videos}
router.use("/offline", clientOfflineRoutes); // -> /api/v1/client/offline/*
router.use("/wishlist", clientWishlistRoutes); // -> /api/v1/client/wishlist/*
router.use("/cart", clientCartRoutes); // -> /api/v1/client/cart/*
router.use("/payment", clientPaymentRoutes); // -> /api/v1/client/payment/*
router.use("/purchase-history", clientPurchaseHistoryRoutes); // -> /api/v1/client/purchase-history/*
router.use("/my-subscriptions", clientMySubscriptionsRoutes); // -> /api/v1/client/my-subscriptions
router.use("/webhook", clientWebhookRoutes); // -> /api/v1/client/webhook/*
router.use("/tracking", clientTrackingRoutes); // -> /api/v1/client/tracking
router.use("/save", clientSaveRoutes); // -> /api/v1/client/save/answers (old-API compat)
router.use("/", clientCategoriesRoutes); // -> /api/v1/client/{video|material|exam}-categories/:id/{videos|materials|exams}
router.use("/video-folders", videoFolderRouter); // -> /api/v1/client/video-folders/*
router.use("/material-folders", materialFolderRouter); // -> /api/v1/client/material-folders/*
router.use("/exam-countdowns", clientExamCountdownRoutes); // -> /api/v1/client/exam-countdowns/*
router.use("/educators", clientEducatorRoutes); // -> /api/v1/client/educators/*
router.use("/live-chat",  clientLiveChatRoutes);          // -> /api/v1/client/live-chat/:liveClassId/history
router.use("/live-polls", clientLivePollRoutes);          // -> /api/v1/client/live-polls/:liveClassId/active
router.use("/search", clientSearchRoutes);                // -> /api/v1/client/search
router.use("/live-sessions", clientLiveSessionRoutes);    // -> /api/v1/client/live-sessions/:streamId
router.use("/live-courses",  clientLiveCourseRoutes);     // -> /api/v1/client/live-courses/*

export default router;
