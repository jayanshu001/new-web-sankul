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
import { validateCoin } from "../referral/wallet-debit";
import { _shared } from "../testSeries/testSeries.controller";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createOrderSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1).optional(),
  // Optional wallet ("coin") amount in rupees. Validated (≤ balance, ≤ 50% of
  // plan price), subtracted from the charge, debited at /verify success.
  coin: z.number().int().min(0).optional(),
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

    // Test series is now a first-class appliesTo type, so a promo created with
    // appliesTo.type:"testSeries" matches here.
    const { result, error } = await resolveLivePromo(promocode, plan.price, {
      type: "testSeries",
      id: String(plan.testSeriesId),
    }, String(plan._id), customerId);
    if (error || !result) {
      logger.warn("applyTestSeriesPromo promo rejected", { traceId, customerId, planId, promocode, error });
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }

    const bd = _shared.computeBreakdown(
      plan.price,
      result.discountAmount,
      result.promo ? String(result.promo._id) : null
    );

    logger.info("applyTestSeriesPromo success", { traceId, customerId, planId, promocode, total: bd.totalAmount, isReferral: !!result.referrerId });
    return res.status(200).json({
      success: true,
      data: {
        planId: String(plan._id),
        testSeriesId: String(plan.testSeriesId),
        promocode: result.promo ? result.promo.promocode : promocode.trim().toUpperCase(),
        promocodeId: result.promo ? String(result.promo._id) : null,
        isReferral: !!result.referrerId,
        discountType: result.discountType,
        discountValue: result.discountValue,
        breakdown: bd,
        // Per-plan applicability flags — same contract as /promocodes/apply.
        // Single-plan endpoint: a reachable success is always applicable;
        // out-of-scope/invalid plans are rejected with a 400 above.
        offerApplicable: true,
        offerReason: null,
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

    const { planId, promocode, coin: coinRaw } = createOrderSchema.parse(req.body);

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
    let promoterId: string | null = null;
    let promoterPercentage: number | null = null;
    let promoterCommission: number | null = null;
    let referrerId: string | null = null;
    let customerPercentage: number | null = null;
    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price, {
        type: "testSeries",
        id: String(plan.testSeriesId),
      }, String(plan._id), customerId);
      if (error || !result) {
        logger.warn("createTestSeriesOrderPayment promo rejected", { traceId, customerId, promocode, error });
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      discountAmount = result.discountAmount;
      // promo is null on the referral path; referrerId is set instead.
      promocodeId = result.promo ? String(result.promo._id) : null;
      promoterId = result.promo?.promoterId ? String(result.promo.promoterId) : null;
      promoterPercentage = result.promoterPercentage;
      promoterCommission = result.promoterCommission;
      referrerId = result.referrerId ? String(result.referrerId) : null;
      customerPercentage = result.customerPercentage;
    }
    const bd = _shared.computeBreakdown(plan.price, discountAmount, promocodeId);

    // Wallet ("coin"): validate against balance + 50%-of-plan-price cap, then
    // subtract from the breakdown total. Recorded now, debited at /verify.
    const coinCheck = await validateCoin(customerId, plan.price, coinRaw);
    if ("error" in coinCheck) {
      logger.warn("createTestSeriesOrderPayment coin rejected", { traceId, customerId, coin: coinRaw, error: coinCheck.error });
      return res.status(400).json({ success: false, message: coinCheck.error });
    }
    const coinsUsed = coinCheck.coin;
    const chargeAmount = Math.max(0, bd.totalAmount - coinsUsed);

    if (chargeAmount < 1) {
      logger.warn("createTestSeriesOrderPayment below minimum", { traceId, customerId, totalAmount: bd.totalAmount, coinsUsed });
      return res.status(400).json({
        success: false,
        message:
          "Final amount is below the minimum payable. Please reduce wallet usage or contact support.",
      });
    }

    const order = await TestSeriesOrder.create({
      customerId,
      testSeriesId: plan.testSeriesId,
      planId: plan._id,
      paymentMethod: PaymentMethod.RAZORPAY,
      orderType: PackageCourseEbookOrderType.PURCHASE,
      orderPrice: chargeAmount,
      basePrice: bd.basePrice,
      discountAmount: bd.discountAmount,
      gstAmount: bd.gstAmount,
      handlingFee: bd.handlingFee,
      promocodeId,
      promoterId,
      promoterPercentage,
      promoterCommission,
      referrerId,
      customerPercentage,
      coinsUsed,
      status: PackageCourseEbookOrderStatus.PENDING,
    });

    const receiptId = `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100),
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

    logger.info("createTestSeriesOrderPayment success", { traceId, customerId, orderId: order._id, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
    return res.status(201).json({
      success: true,
      data: {
        testSeriesOrderId: order._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: chargeAmount,
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
