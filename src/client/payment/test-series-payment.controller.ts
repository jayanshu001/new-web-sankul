import { Request, Response } from "express";
import { z } from "zod";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import { TestSeriesPrice } from "../../models/testSeries/TestSeriesPrice.model";
import { TestSeriesOrder } from "../../models/testSeries/TestSeriesOrder.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookOrderType,
  PaymentMethod,
} from "../../models/enums";
import { resolveLivePromo } from "../live-course/promo";
import { _shared } from "../testSeries/testSeries.controller";
import { getRazorpay, razorpayResponseFor } from "./razorpay";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createOrderSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1).optional(),
});

const applyPromoSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1),
});

// POST /api/v1/client/payment/apply-promo/test-series
// Preview-only. Mirrors apply-promo/live-course.
export const applyTestSeriesPromo = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { planId, promocode } = applyPromoSchema.parse(req.body);

    const plan = await TestSeriesPrice.findOne({ _id: planId, status: true });
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

    const bd = _shared.computeBreakdown(
      plan.price,
      result.discountAmount,
      String(result.promo._id)
    );

    return res.status(200).json({
      success: true,
      data: {
        planId: String(plan._id),
        testSeriesId: String(plan.testSeriesId),
        promocode: result.promo.promocode,
        promocodeId: String(result.promo._id),
        discountType: result.discountType,
        discountValue: result.discountValue,
        breakdown: bd,
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/payment/create-order/test-series
// Body: { planId, promocode? }. Creates TestSeriesOrder PENDING + Razorpay order.
// /payment/verify provisions TestSeriesSubscription on signature success.
export const createTestSeriesOrderPayment = async (req: Request, res: Response) => {
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

    const plan = await TestSeriesPrice.findOne({ _id: planId, status: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    if (!plan.price || plan.price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the admin grant flow instead.",
      });
    }

    const series = await TestSeries.findOne({ _id: plan.testSeriesId, status: true });
    if (!series) {
      return res.status(404).json({ success: false, message: "Test series not found or inactive." });
    }

    // Block double-buy on overlapping access.
    const now = new Date();
    const activeSub = await TestSeriesSubscription.findOne({
      customerId,
      testSeriesId: plan.testSeriesId,
      status: true,
      endAt: { $gt: now },
    });
    if (activeSub) {
      return res.status(409).json({
        success: false,
        message: "You already have an active subscription to this test series.",
      });
    }

    // Re-validate promo and compute the breakdown server-side.
    let discountAmount = 0;
    let promocodeId: string | null = null;
    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price);
      if (error || !result) {
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      discountAmount = result.discountAmount;
      promocodeId = String(result.promo._id);
    }
    const bd = _shared.computeBreakdown(plan.price, discountAmount, promocodeId);

    if (bd.totalAmount < 1) {
      return res.status(400).json({
        success: false,
        message:
          "Final amount is below the minimum payable. Please contact support.",
      });
    }

    const order = await TestSeriesOrder.create({
      customerId,
      testSeriesId: plan.testSeriesId,
      planId: plan._id,
      paymentMethod: PaymentMethod.RAZORPAY,
      orderType: PackageCourseEbookOrderType.PURCHASE,
      orderPrice: bd.totalAmount,
      basePrice: bd.basePrice,
      discountAmount: bd.discountAmount,
      gstAmount: bd.gstAmount,
      handlingFee: bd.handlingFee,
      promocodeId,
      status: PackageCourseEbookOrderStatus.PENDING,
    });

    const receiptId = `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await rp.orders.create({
      amount: Math.round(bd.totalAmount * 100),
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "test-series",
        testSeriesOrderId: String(order._id),
        testSeriesId: String(plan.testSeriesId),
        planId: String(plan._id),
        customerId: String(customerId),
        ...(promocodeId ? { promocodeId } : {}),
      },
    });

    order.razorpayOrderId = rzpOrder.id;
    await order.save();

    return res.status(201).json({
      success: true,
      data: {
        testSeriesOrderId: order._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: bd.totalAmount,
        breakdown: bd,
        testSeries: { _id: series._id, title: series.title },
        plan: {
          _id: plan._id,
          durationDays: plan.durationDays,
          price: plan.price,
          originalPrice: plan.originalPrice ?? null,
        },
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating test-series payment order.";
    console.error("[payment/create-order/test-series] failed:", e);
    return res.status(500).json({ success: false, message });
  }
};
