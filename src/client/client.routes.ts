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
import clientWebhookRoutes from "./webhook/webhook.routes";
import clientTrackingRoutes from "./tracking/tracking.routes";
import clientSaveRoutes from "./save/save.routes";
import clientFreeRoutes from "./free/free.routes";
import clientCategoriesRoutes from "./categories/categories.routes";
import clientFolderRoutes from "./folder/folder.routes";
import clientExamCountdownRoutes from "./examCountdown/examCountdown.routes";

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
router.use("/webhook", clientWebhookRoutes); // -> /api/v1/client/webhook/*
router.use("/tracking", clientTrackingRoutes); // -> /api/v1/client/tracking
router.use("/save", clientSaveRoutes); // -> /api/v1/client/save/answers (old-API compat)
router.use("/", clientCategoriesRoutes); // -> /api/v1/client/{video|material|exam}-categories/:id/{videos|materials|exams}
router.use("/folders", clientFolderRoutes); // -> /api/v1/client/folders/*
router.use("/exam-countdowns", clientExamCountdownRoutes); // -> /api/v1/client/exam-countdowns/*

export default router;
