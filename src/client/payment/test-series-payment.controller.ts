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
import { resolvePromoForPlanSql } from "../../modules/promo-code/promo-code.service";
import { _shared } from "../testSeries/testSeries.controller";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as tsSql from "../../modules/test-series-order/test-series-order.service";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createOrderSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1).optional(),
});

const applyPromoSchema = z.object({
  planId: objectId,
  promocode: z.string().trim().min(1),
});

// SQL planId is numeric (migrated id-space).
const applyPromoSqlSchema = z.object({ planId: z.coerce.number().int().positive(), promocode: z.string().trim().min(1) });
const createOrderSqlSchema = z.object({ planId: z.coerce.number().int().positive(), promocode: z.string().trim().min(1).optional() });

// POST /api/v1/client/payment/apply-promo/test-series
// Preview-only. Mirrors apply-promo/live-course.
export const applyTestSeriesPromo = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("applyTestSeriesPromo invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("applyTestSeriesPromo unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ── MySQL test-series promo preview (test-series-order flag) ──────────────
    if (tsSql.isTestSeriesOrderMysql()) {
      const body = applyPromoSqlSchema.parse(req.body);
      const plan = await tsSql.findPlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan not found, inactive, or zero price." });
      const { result, error } = await resolvePromoForPlanSql(body.promocode, plan.price, { type: "testSeries", id: plan.testSeriesId }, body.planId);
      if (error || !result) return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      const bd = _shared.computeBreakdown(plan.price, result.discountAmount, String(result.promo._id));
      return res.status(200).json({ success: true, data: {
        planId: String(plan.id), testSeriesId: String(plan.testSeriesId), promocode: result.promo.promocode,
        promocodeId: String(result.promo._id), discountType: result.discountType, discountValue: result.discountValue, breakdown: bd,
      }});
    }

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

    // ── MySQL test-series create-order (test-series-order flag) ───────────────
    if (tsSql.isTestSeriesOrderMysql()) {
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) return res.status(400).json({ success: false, message: "Invalid customer id." });
      const body = createOrderSqlSchema.parse(req.body);
      const plan = await tsSql.findPlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan not found, inactive, or zero price." });
      const series = await tsSql.findSeries(plan.testSeriesId);
      if (!series) return res.status(404).json({ success: false, message: "Test series not found or inactive." });

      let discountAmount = 0; let promocodeIdNum: number | null = null;
      if (body.promocode) {
        const { result, error } = await resolvePromoForPlanSql(body.promocode, plan.price, { type: "testSeries", id: plan.testSeriesId }, body.planId);
        if (error || !result) return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
        discountAmount = result.discountAmount;
        const pid = Number(String(result.promo._id)); promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
      }
      const bd = _shared.computeBreakdown(plan.price, discountAmount, promocodeIdNum != null ? String(promocodeIdNum) : null);
      if (bd.totalAmount < 1) return res.status(400).json({ success: false, message: "Final amount is below the minimum payable. Please contact support." });

      const receiptId = `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rzpOrder = await createRazorpayOrder(rp, {
        amount: Math.round(bd.totalAmount * 100), currency: "INR", receipt: receiptId,
        notes: { kind: "test-series", testSeriesId: String(plan.testSeriesId), planId: String(body.planId), customerId: String(customerIdInt), ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}) },
      });
      const { orderId } = await tsSql.createOrderMysql({ customerId: customerIdInt, testSeriesId: plan.testSeriesId, planId: body.planId, bd, promocodeId: promocodeIdNum, razorpayOrderId: rzpOrder.id });
      logger.info("createTestSeriesOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: bd.totalAmount });
      return res.status(201).json({ success: true, data: {
        testSeriesOrderId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: bd.totalAmount, breakdown: bd,
        testSeries: { _id: String(series.id), title: series.title },
        plan: { _id: String(body.planId), durationDays: plan.durationDays, price: plan.price, originalPrice: plan.originalPrice },
      }});
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
        type: "testSeries",
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
