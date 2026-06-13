import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { resolveLivePromo } from "../live-course/promo";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createCourseOrderSchema = z.object({
  // PackageCourseEbookPrice._id — the specific plan/duration the user picked.
  // We deliberately key on this rather than (courseId, duration) because the
  // PackageCourseEbookPrice row is the single source of truth for the price.
  packageId: objectId,
  // Optional delivery address (a CustomerAddress._id) for "With Materials"
  // plans, which ship physical material to the buyer. Always optional at the
  // schema level so existing callers are unaffected; when supplied it must be an
  // address the customer owns. Stored on the subscription as customerShippingId,
  // mirroring the admin create-subscription flow.
  customerShippingId: objectId.optional(),
  // Optional promo code. Re-validated server-side against THIS course and the
  // Razorpay order charged for the reduced amount. Mirrors the live-course flow.
  promocode: z.string().trim().min(1).optional(),
});

// POST /api/v1/client/payment/create-order/course
// Creates a PackageCourseSubscription in paymentStatus="pending" and a Razorpay
// order. After /verify flips paymentStatus → "verified", access is granted.
export const createCourseOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createCourseOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createCourseOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createCourseOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    const { packageId, customerShippingId, promocode } = createCourseOrderSchema.parse(req.body);

    // Validate the delivery address (when supplied) belongs to this customer.
    // Optional throughout — only checked if the FE sent one. Mirrors the admin
    // subscription flow's ownership check.
    if (customerShippingId) {
      const addr = await CustomerAddress.findOne({ _id: customerShippingId, customerId }).select("_id");
      if (!addr) {
        logger.warn("createCourseOrderPayment address not owned", { traceId, customerId, customerShippingId });
        return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
      }
    }

    const plan = await PackageCourseEbookPrice.findOne({ _id: packageId, status: true });
    if (!plan) { logger.warn("createCourseOrderPayment plan not found", { traceId, customerId, packageId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.courseId) { logger.warn("createCourseOrderPayment not a course plan", { traceId, customerId, packageId }); return res.status(400).json({ success: false, message: "This plan is not a course plan. Use the matching endpoint for ebook plans." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("createCourseOrderPayment zero price", { traceId, customerId, packageId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const course = await Course.findOne({ _id: plan.courseId, status: true });
    if (!course) { logger.warn("createCourseOrderPayment course not found", { traceId, customerId, courseId: plan.courseId }); return res.status(404).json({ success: false, message: "Course not found or inactive." }); }

    // Resolve the promo code (if any) against THIS course and derive the amount
    // to charge. Re-validated here — the /promocodes/apply preview is never
    // trusted. Mirrors createLiveCourseOrderPayment.
    let chargeAmount = plan.price;
    let promocodeId: string | null = null;
    let originalAmount: number | null = null;
    let discountAmount: number | null = null;
    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price, {
        type: "course",
        id: String(plan.courseId),
      });
      if (error || !result) {
        logger.warn("createCourseOrderPayment promo rejected", { traceId, customerId, promocode, error });
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      if (result.finalAmount < 1) {
        logger.warn("createCourseOrderPayment promo zeroes amount", { traceId, customerId, promocode });
        return res.status(400).json({
          success: false,
          message: "This promo code reduces the price below the minimum payable amount. Please contact support.",
        });
      }
      chargeAmount = result.finalAmount;
      promocodeId = String(result.promo._id);
      originalAmount = result.originalAmount;
      discountAmount = result.discountAmount;
    }

    // Re-purchasing an active plan is an "Extend Validity" action, NOT a
    // double-buy error. We create a fresh pending row regardless; /payment/verify
    // folds the purchased window onto the existing active subscription (extending
    // its endAt) and retires this row, so the customer never ends up with two
    // overlapping cards. See verify.controller course/package branch.

    // Create local row first (pending). Verify endpoint flips it to verified.
    const subscription = await PackageCourseSubscription.create({
      customerId,
      courseId: plan.courseId,
      packageId: plan._id,
      promocodeId,
      originalAmount,
      discountAmount,
      paidAmount: chargeAmount,
      paymentStatus: "pending",
      status: true,
      // Stamp the material/shipping intent from the chosen plan + request. Both
      // optional: a "Without Materials" plan stays withMaterial:false and a
      // null address, unchanged from before.
      withMaterial: !!plan.withMaterial,
      customerShippingId: customerShippingId ?? null,
    });

    const receiptId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "course",
        subscriptionId: String(subscription._id),
        courseId: String(plan.courseId),
        packageId: String(plan._id),
        customerId: String(customerId),
        ...(promocodeId ? { promocodeId } : {}),
      },
    });

    subscription.razorpayOrderId = rzpOrder.id;
    await subscription.save();

    logger.info("createCourseOrderPayment success", { traceId, customerId, subscriptionId: subscription._id, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        // Amount actually charged (post-discount); plan.price is the pre-discount MRP.
        amountInRupees: chargeAmount,
        course: {
          _id: course._id,
          name: course.name,
        },
        plan: {
          _id: plan._id,
          duration: plan.duration,
          price: plan.price,
        },
        promo: promocodeId
          ? { promocodeId, originalAmount, discountAmount, finalAmount: chargeAmount }
          : null,
      },
    });
  } catch (e: any) {
    if (e.issues) { logger.warn("createCourseOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("createCourseOrderPayment failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
