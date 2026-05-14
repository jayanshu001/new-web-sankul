import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { createBookOrderPayment } from "./payment.controller";
import { createCourseOrderPayment } from "./course-payment.controller";
import { createEbookOrderPayment } from "./ebook-payment.controller";
import { createPackageOrderPayment } from "./package-payment.controller";
import {
  createLiveCourseOrderPayment,
  applyLiveCoursePromo,
} from "./live-course-payment.controller";
import { verifyPayment } from "./verify.controller";

const router = Router();

router.use(authenticate);

// Book cart checkout — reads active BookCart, no body.
router.post("/create-order", createBookOrderPayment);

// Course purchase — body: { packageId }. Each purchase type gets its own
// endpoint because the validation, source of price, and local row created
// are all different. The Razorpay-SDK plumbing is shared via ./razorpay.ts.
router.post("/create-order/course", createCourseOrderPayment);

// Ebook purchase — body: { planId }. Same shape as course: per-purchase-type
// endpoint because the local row (EbookOrder) and fulfillment (EbookSubscription)
// differ from book/course flows. Razorpay-SDK plumbing shared via ./razorpay.ts.
router.post("/create-order/ebook", createEbookOrderPayment);

// Package purchase — body: { packageId } (a PackageCourseEbookPrice._id whose
// target is a Package, not a Course/Ebook). Mirrors the course flow.
router.post("/create-order/package", createPackageOrderPayment);

// Live course purchase — body: { planId, promocode? } (a LiveCoursePlan._id).
// Mirrors the course flow but isolated from PackageCourseSubscription /
// PackageCourseEbookPrice.
router.post("/create-order/live-course", createLiveCourseOrderPayment);

// Live course promo preview — body: { planId, promocode }. Returns the price
// breakdown so the UI can show the discounted total before checkout. The
// discount is always re-validated inside create-order.
router.post("/apply-promo/live-course", applyLiveCoursePromo);

// Verify — single endpoint for both book and course payments. Dispatches
// fulfillment based on which local row holds the razorpay_order_id.
router.post("/verify", verifyPayment);

export default router;
