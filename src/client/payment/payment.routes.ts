import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { createBookOrderPayment } from "./payment.controller";
import { createCourseOrderPayment } from "./course-payment.controller";
import { verifyPayment } from "./verify.controller";

const router = Router();

router.use(authenticate);

// Book cart checkout — reads active BookCart, no body.
router.post("/create-order", createBookOrderPayment);

// Course purchase — body: { packageId }. Each purchase type gets its own
// endpoint because the validation, source of price, and local row created
// are all different. The Razorpay-SDK plumbing is shared via ./razorpay.ts.
router.post("/create-order/course", createCourseOrderPayment);

// Verify — single endpoint for both book and course payments. Dispatches
// fulfillment based on which local row holds the razorpay_order_id.
router.post("/verify", verifyPayment);

export default router;
