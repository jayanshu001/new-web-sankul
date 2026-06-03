import { Request, Response } from "express";
import { z } from "zod";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import { TestSeriesPrice } from "../../models/testSeries/TestSeriesPrice.model";
import { TestSeriesOrder } from "../../models/testSeries/TestSeriesOrder.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookOrderType,
  PaymentMethod,
} from "../../models/enums";
import { resolveLivePromo } from "../live-course/promo";
import { _shared } from "../testSeries/testSeries.controller";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

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
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("applyTestSeriesPromo invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("applyTestSeriesPromo unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { planId, promocode } = applyPromoSchema.parse(req.body);

    const plan = await TestSeriesPrice.findOne({ _id: planId, status: true });
    if (!plan) { logger.warn("applyTestSeriesPromo plan not found", { traceId, customerId, planId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("applyTestSeriesPromo zero price", { traceId, customerId, planId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — promo codes don't apply.",
      });
    }

    // Test series isn't in the appliesTo enum yet — promocodes won't match.
    // Until the enum is extended, this branch returns "not valid for this item".
    const { result, error } = await resolveLivePromo(promocode, plan.price, {
      type: "liveCourse",
      id: String(plan.testSeriesId),
    });
    if (error || !result) {
      logger.warn("applyTestSeriesPromo promo rejected", { traceId, customerId, planId, promocode, error });
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }

    const bd = _shared.computeBreakdown(
      plan.price,
      result.discountAmount,
      String(result.promo._id)
    );

    logger.info("applyTestSeriesPromo success", { traceId, customerId, planId, promocode, total: bd.totalAmount });
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
    if (e.issues) { logger.warn("applyTestSeriesPromo validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("applyTestSeriesPromo failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/payment/create-order/test-series
// Body: { planId, promocode? }. Creates TestSeriesOrder PENDING + Razorpay order.
// /payment/verify provisions TestSeriesSubscription on signature success.
export const createTestSeriesOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createTestSeriesOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createTestSeriesOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createTestSeriesOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    const { planId, promocode } = createOrderSchema.parse(req.body);

    const plan = await TestSeriesPrice.findOne({ _id: planId, status: true });
    if (!plan) { logger.warn("createTestSeriesOrderPayment plan not found", { traceId, customerId, planId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("createTestSeriesOrderPayment zero price", { traceId, customerId, planId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the admin grant flow instead.",
      });
    }

    const series = await TestSeries.findOne({ _id: plan.testSeriesId, status: true });
    if (!series) { logger.warn("createTestSeriesOrderPayment series not found", { traceId, customerId, testSeriesId: plan.testSeriesId }); return res.status(404).json({ success: false, message: "Test series not found or inactive." }); }

    // Re-purchasing an active test series is an "Extend Validity" action, NOT a
    // double-buy error. We create a fresh pending order regardless; /payment/verify
    // folds the purchased days onto the existing active subscription (extending
    // its endAt) instead of creating a second row. See verify.controller
    // test-series branch.

    // Re-validate promo and compute the breakdown server-side.
    let discountAmount = 0;
    let promocodeId: string | null = null;
    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price, {
        type: "liveCourse",
        id: String(plan.testSeriesId),
      });
      if (error || !result) {
        logger.warn("createTestSeriesOrderPayment promo rejected", { traceId, customerId, promocode, error });
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      discountAmount = result.discountAmount;
      promocodeId = String(result.promo._id);
    }
    const bd = _shared.computeBreakdown(plan.price, discountAmount, promocodeId);

    if (bd.totalAmount < 1) {
      logger.warn("createTestSeriesOrderPayment below minimum", { traceId, customerId, totalAmount: bd.totalAmount });
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

    const rzpOrder = await createRazorpayOrder(rp, {
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

    logger.info("createTestSeriesOrderPayment success", { traceId, customerId, orderId: order._id, razorpayOrderId: rzpOrder.id, amount: bd.totalAmount });
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
    if (e.issues) { logger.warn("createTestSeriesOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating test-series payment order.";
    logger.error("createTestSeriesOrderPayment failed", { traceId, customerId, error: message, stack: e?.stack });
    return res.status(500).json({ success: false, message });
  }
};
