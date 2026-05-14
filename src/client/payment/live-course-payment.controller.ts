import { Request, Response } from "express";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { resolveLivePromo } from "../live-course/promo";
import { getRazorpay, razorpayResponseFor } from "./razorpay";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createOrderSchema = z.object({
  // LiveCoursePlan._id — single source of truth for price/duration.
  planId: objectId,
  // Optional. When present, a promo-level discount is applied to the plan
  // price and the Razorpay order is created for the reduced amount.
  promocode: z.string().trim().min(1).optional(),
});

const applyPromoSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1),
});

// POST /api/v1/client/payment/apply-promo/live-course
// Preview-only: validates a promo code against a plan and returns the price
// breakdown. The discount is re-validated server-side at create-order time —
// this endpoint is purely so the UI can show the final price before checkout.
export const applyLiveCoursePromo = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { planId, promocode } = applyPromoSchema.parse(req.body);

    const plan = await LiveCoursePlan.findOne({ _id: planId, status: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    if (!plan.price || plan.price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — promo codes don't apply.",
      });
    }

    const { result, error } = await resolveLivePromo(promocode, plan.price);
    if (error || !result) {
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }

    return res.status(200).json({
      success: true,
      data: {
        planId: String(plan._id),
        liveCourseId: String(plan.liveCourseId),
        promocode: result.promo.promocode,
        promocodeId: String(result.promo._id),
        discountType: result.discountType,
        discountValue: result.discountValue,
        originalAmount: result.originalAmount,
        discountAmount: result.discountAmount,
        finalAmount: result.finalAmount,
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/payment/create-order/live-course
// Mirrors createCourseOrderPayment but writes to LiveCourseSubscription so the
// existing course flow stays isolated. Body: { planId, promocode? }.
export const createLiveCourseOrderPayment = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const rp = getRazorpay();
    if (!rp) {
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    const { planId, promocode } = createOrderSchema.parse(req.body);

    const plan = await LiveCoursePlan.findOne({ _id: planId, status: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    if (!plan.price || plan.price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const course = await LiveCourse.findOne({ _id: plan.liveCourseId, status: true });
    if (!course) {
      return res.status(404).json({ success: false, message: "Live course not found or inactive." });
    }

    const now = new Date();
    const existingPaid = await LiveCourseSubscription.findOne({
      customerId,
      liveCourseId: plan.liveCourseId,
      status: true,
      paymentStatus: "verified",
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    });
    if (existingPaid) {
      return res.status(409).json({
        success: false,
        message: "You already have an active subscription to this live course.",
      });
    }

    // Resolve the promo code (if any) and derive the amount to charge. The
    // discount is always re-validated here — the preview endpoint's result is
    // never trusted.
    let chargeAmount = plan.price;
    let promocodeId: string | null = null;
    let originalAmount: number | null = null;
    let discountAmount: number | null = null;

    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price);
      if (error || !result) {
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      // Razorpay rejects sub-₹1 orders; a code that zeroes the price can't go
      // through online checkout — admin should free-grant instead.
      if (result.finalAmount < 1) {
        return res.status(400).json({
          success: false,
          message:
            "This promo code reduces the price below the minimum payable amount. Please contact support.",
        });
      }
      chargeAmount = result.finalAmount;
      promocodeId = String(result.promo._id);
      originalAmount = result.originalAmount;
      discountAmount = result.discountAmount;
    }

    const subscription = await LiveCourseSubscription.create({
      customerId,
      liveCourseId: plan.liveCourseId,
      planId: plan._id,
      promocodeId,
      originalAmount,
      discountAmount,
      paidAmount: chargeAmount,
      paymentStatus: "pending",
      status: true,
    });

    const receiptId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await rp.orders.create({
      amount: Math.round(chargeAmount * 100),
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "live-course",
        subscriptionId: String(subscription._id),
        liveCourseId: String(plan.liveCourseId),
        planId: String(plan._id),
        customerId: String(customerId),
        ...(promocodeId ? { promocodeId } : {}),
      },
    });

    subscription.razorpayOrderId = rzpOrder.id;
    await subscription.save();

    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: chargeAmount,
        liveCourse: { _id: course._id, name: course.name },
        plan: { _id: plan._id, duration: plan.duration, price: plan.price },
        // Present only when a promo code was applied.
        promo: promocodeId
          ? { promocodeId, originalAmount, discountAmount, finalAmount: chargeAmount }
          : null,
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};
