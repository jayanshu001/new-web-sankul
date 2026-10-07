// Client payments: create-order, promo preview and verify routes.
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
import {
  createTestSeriesOrderPayment,
  applyTestSeriesPromo,
} from "./test-series-payment.controller";
import { verifyPayment } from "./verify.controller";

const router = Router();

router.use(authenticate);

// Book cart checkout: reads the active BookCart, no body.
router.post("/create-order", createBookOrderPayment);

// One create-order endpoint per purchase type: validation, price source and local row
// differ. Razorpay plumbing is shared via ./razorpay.ts.
router.post("/create-order/course", createCourseOrderPayment);

router.post("/create-order/ebook", createEbookOrderPayment);

// body: { packageId }, a price-row id whose target is a Package.
router.post("/create-order/package", createPackageOrderPayment);

router.post("/create-order/live-course", createLiveCourseOrderPayment);

// Price preview only; the discount is re-validated inside create-order.
router.post("/apply-promo/live-course", applyLiveCoursePromo);

router.post("/create-order/test-series", createTestSeriesOrderPayment);

// Price preview with full GST + handling-fee breakdown.
router.post("/apply-promo/test-series", applyTestSeriesPromo);

// Single verify endpoint; dispatches fulfillment by which local row holds the razorpay_order_id.
router.post("/verify", verifyPayment);

export default router;
