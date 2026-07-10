import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql, findActiveByCode, promoCovers, loadTestSeriesPlanDiscountsSql, resolveReferralCode, referralCovers } from "../../modules/promo-code/promo-code.service";
import { computePromoDiscount } from "../promocode/applies-to";
import { _shared } from "../testSeries/testSeries.controller";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as tsSql from "../../modules/test-series-order/test-series-order.service";

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

    // ── MySQL test-series promo preview (test-series-order) ──────────────────
    // Returns the SAME shape as POST /client/promocodes/apply: the entity + ALL
    // its pricing plans, each annotated with the per-plan offer (orginalPrice,
    // price, offerAvailable, discountType, discountValue, offerPercentage).
    {
      const body = applyPromoSqlSchema.parse(req.body);
      const plan = await tsSql.findPlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan not found, inactive, or zero price." });
      const testSeriesId = plan.testSeriesId;

      const promo = await findActiveByCode(body.promocode);
      if (!promo) {
        // Not a promocode — try it as a referral code (global % on test series).
        const referral = await resolveReferralCode(body.promocode);
        if (referral && referralCovers("testSeries")) {
          if (referral.referrerId === Number(customerId)) {
            return res.status(400).json({ success: false, message: "You can't use your own referral code." });
          }
          const rows = await tsSql.listPlansForSeries(testSeriesId);
          const plans = rows.map((p: any) => {
            const basePrice = Number(p.price);
            const discount = computePromoDiscount({ discountType: referral.discountType, discountValue: referral.discountValue }, basePrice);
            return {
              id: p.id,
              testSeriesId: p.testSeriesId,
              name: p.name ?? null,
              duration: p.durationDays,
              price: Math.max(0, basePrice - discount),
              originalPrice: p.originalPrice != null ? Number(p.originalPrice) : null,
              isDefault: p.isDefault,
              status: p.status,
              isMostPopular: p.isMostPopular ?? false,
              created_at: p.createdAt ?? null,
              updated_at: p.updatedAt ?? null,
              orginalPrice: basePrice,
              offerAvailable: referral.discountValue > 0,
              discountType: referral.discountType,
              discountValue: referral.discountValue,
              offerPercentage: referral.discountValue,
            };
          });
          logger.info("applyTestSeriesPromo success (referral)", { traceId, customerId, testSeriesId, promocode: body.promocode });
          return res.status(200).json({
            success: true,
            data: {
              _id: "",
              promocode: body.promocode.toUpperCase(),
              codeType: "referral",
              discountType: referral.discountType,
              discountValue: referral.discountValue,
              id: testSeriesId,
              key: "testSeries",
              plans: { withMaterial: [], withoutMaterial: plans },
            },
          });
        }
        return res.status(400).json({ success: false, message: "Invalid or expired promo code." });
      }
      if (!promoCovers(promo, { type: "testSeries", id: testSeriesId })) {
        return res.status(404).json({ success: false, message: "This promocode is not applicable for this item." });
      }

      const promoDiscountType = promo.discountType as "flat" | "percentage";
      const promoDiscountValue = Number(promo.discountValue ?? 0);
      // Per-plan links are authoritative; a plan with no link gets no discount.
      // Legacy codes with NO links fall back to the global discountValue.
      const planDiscounts = await loadTestSeriesPlanDiscountsSql(promo.id);
      const hasLinks = planDiscounts.size > 0;
      if (!hasLinks && !(promoDiscountValue > 0)) {
        return res.status(400).json({ success: false, message: "This promocode has no discount configured." });
      }

      const rows = await tsSql.listPlansForSeries(testSeriesId);
      let matchedAny = false;
      const plans = rows.map((p: any) => {
        const basePrice = Number(p.price);
        const out: any = {
          id: p.id,
          testSeriesId: p.testSeriesId,
          name: p.name ?? null,
          duration: p.durationDays,
          price: basePrice,
          originalPrice: p.originalPrice != null ? Number(p.originalPrice) : null,
          isDefault: p.isDefault,
          status: p.status,
          isMostPopular: p.isMostPopular ?? false,
          created_at: p.createdAt ?? null,
          updated_at: p.updatedAt ?? null,
          orginalPrice: basePrice,
          offerAvailable: false,
          discountType: promoDiscountType,
          discountValue: 0,
          offerPercentage: 0,
        };
        let dType: "flat" | "percentage";
        let dValue: number;
        if (hasLinks) {
          const pct = planDiscounts.get(p.id);
          if (pct == null) return out; // covered entity, but this plan has no link → no discount
          dType = "percentage";
          dValue = pct;
        } else {
          dType = promoDiscountType;
          dValue = promoDiscountValue;
        }
        matchedAny = true;
        out.offerAvailable = dValue > 0;
        out.discountType = dType;
        out.discountValue = dValue;
        const discount = computePromoDiscount({ discountType: dType, discountValue: dValue }, basePrice);
        if (dType === "percentage") out.offerPercentage = dValue;
        out.price = Math.max(0, basePrice - discount);
        return out;
      });

      if (hasLinks && !matchedAny) {
        return res.status(404).json({ success: false, message: "This promocode is not applicable for this item." });
      }

      logger.info("applyTestSeriesPromo success (sql)", { traceId, customerId, testSeriesId, promocode: body.promocode });
      return res.status(200).json({
        success: true,
        data: {
          _id: String(promo.id),
          promocode: promo.promocode,
          codeType: "promocode",
          discountType: promoDiscountType,
          discountValue: promoDiscountValue,
          id: testSeriesId,
          key: "testSeries",
          plans: { withMaterial: [], withoutMaterial: plans },
        },
      });
    }
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

    // ── MySQL test-series create-order (test-series-order) ───────────────────
    {
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) return res.status(400).json({ success: false, message: "Invalid customer id." });
      const body = createOrderSqlSchema.parse(req.body);
      const plan = await tsSql.findPlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan not found, inactive, or zero price." });
      const series = await tsSql.findSeries(plan.testSeriesId);
      if (!series) return res.status(404).json({ success: false, message: "Test series not found or inactive." });

      let discountAmount = 0; let promocodeIdNum: number | null = null;
      if (body.promocode) {
        const { result, error } = await resolvePromoForPlanSql(body.promocode, plan.price, { type: "testSeries", id: plan.testSeriesId }, body.planId, customerIdInt);
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
