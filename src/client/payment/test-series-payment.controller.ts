// Client payments: test-series promo preview and create-order handlers.
import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql, findActiveByCode, promoCovers, loadTestSeriesPlanDiscountsSql, resolveReferralCode, referralCovers } from "../../modules/promo-code/promo-code.service";
import { computePromoDiscount } from "../promocode/applies-to";
import { _shared } from "../testSeries/testSeries.controller";
import { razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import logger from "../../utils/logger";
import { getErrorMessage, formatZodError } from "../../utils/httpResponse";
import { ZodError } from "zod";
import * as tsSql from "../../modules/test-series-order/test-series-order.service";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { getClientIp } from "../../utils/clientIp";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";
import {
  planIdField, promocodeField, coinField, requirePaymentCustomer, applyOrderWallet, receiptIdFor, createOrderFailure,
} from "./payment-order.shared";

const applyPromoSqlSchema = z.object({
  planId: z.coerce
    .number({ invalid_type_error: "Please select a valid plan." })
    .int("Please select a valid plan.")
    .positive("Please select a valid plan."),
  promocode: z.string().trim().min(1, "Please enter a promo code."),
});
const createOrderSqlSchema = z.object({
  planId: planIdField("Please select a valid plan."),
  promocode: promocodeField,
  coin: coinField,
});

// Preview only; mirrors apply-promo/live-course.
export const applyTestSeriesPromo = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("applyTestSeriesPromo invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("applyTestSeriesPromo unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // Same shape as POST /client/promocodes/apply: the entity + all its plans, each
    // annotated with the per-plan offer.
    {
      const body = applyPromoSqlSchema.parse(req.body);
      const plan = await tsSql.findPlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
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

      logger.info("applyTestSeriesPromo success", { traceId, customerId, testSeriesId, promocode: body.promocode });
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
    if (e instanceof ZodError) {
      logger.warn("applyTestSeriesPromo validation failed", { traceId, customerId, issues: e.issues });
      const { message, errors } = formatZodError(e);
      return res.status(400).json({ success: false, message, errors });
    }
    logger.error("applyTestSeriesPromo failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: "Something went wrong while applying the promo code. Please try again." });
  }
};

// Body: { planId, promocode? }. Creates a pending order + Razorpay order;
// /payment/verify provisions the subscription.
export const createTestSeriesOrderPayment = async (req: Request, res: Response) => {
  const name = "createTestSeriesOrderPayment";
  const traceId = req.traceId;
  logger.info(`${name} invoked`, { traceId, path: req.originalUrl, customerId: req.user?.id });

  try {
    const ctx = requirePaymentCustomer(req, res, name);
    if (!ctx) return;
    const { customerId, rp } = ctx;
    const body = createOrderSqlSchema.parse(req.body);
    const plan = await tsSql.findPlanForOrder(body.planId);
    if (!plan) return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
    const series = await tsSql.findSeries(plan.testSeriesId);
    if (!series) return res.status(404).json({ success: false, message: "Test series not found or inactive." });

    // Not applyOrderPromo: test series prices through computeBreakdown and checks the
    // minimum on the final total below, not on the promo result.
    let discountAmount = 0; let promocodeIdNum: number | null = null; let referrerIdNum: number | null = null;
    if (body.promocode) {
      const { result, error } = await resolvePromoForPlanSql(body.promocode, plan.price, { type: "testSeries", id: plan.testSeriesId }, body.planId, customerId);
      if (error || !result) return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      discountAmount = result.discountAmount;
      const pid = Number(String(result.promo._id)); promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
      referrerIdNum = result.referrerId ?? null;
    }
    const bd = _shared.computeBreakdown(plan.price, discountAmount, promocodeIdNum != null ? String(promocodeIdNum) : null);
    const wallet = await applyOrderWallet(res, ctx, body.coin, plan.price, bd.totalAmount);
    if (!wallet) return;
    bd.totalAmount = wallet.chargeAmount;
    if (bd.totalAmount < 1) return res.status(400).json({ success: false, message: "Final amount is below the minimum payable. Please contact support." });

    // Purchase-time code snapshot for promoter attribution. `planKind` must be
    // "testSeriesPrice": the three plan tables share an id space, so matching on the
    // plan id alone can snapshot an unrelated plan's promoterPercentage.
    const codeSnapshot = await buildOrderCodeSnapshots({
      promocodeId: promocodeIdNum,
      referrerId: referrerIdNum,
      planId: body.planId,
      planKind: "testSeriesPrice",
    });

    const receiptId = receiptIdFor("ts");
    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(bd.totalAmount * 100), currency: "INR", receipt: receiptId,
      notes: { kind: "test-series", testSeriesId: String(plan.testSeriesId), planId: String(body.planId), customerId: String(customerId), ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}) },
    });
    const { orderId } = await tsSql.createOrderMysql({
      customerId, testSeriesId: plan.testSeriesId, planId: body.planId, bd,
      promocodeId: promocodeIdNum, razorpayOrderId: rzpOrder.id, referrerId: referrerIdNum, coin: wallet.coin,
      uniqueId: receiptId,
      razorpayOrderPayload: JSON.stringify(rzpOrder),
      ipAddress: getClientIp(req, 255),
      promocodeSnapshot: codeSnapshot.promocode,
      refferalcodeSnapshot: codeSnapshot.refferalcode,
    });
    logger.info(`${name} success`, { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: bd.totalAmount });
    queueCRMLead(
      { params: { userId: customerId, testSeriesId: plan.testSeriesId, planId: body.planId, amount: bd.totalAmount }, leadType: CRM_LEAD_TYPE.PAYMENT_MODE },
      { traceId, customerId, orderId }
    );
    return res.status(201).json({ success: true, data: omit({
      testSeriesOrderId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: bd.totalAmount, breakdown: bd,
      testSeries: { _id: String(series.id), title: series.title },
      plan: { _id: String(body.planId), durationDays: plan.durationDays, price: plan.price, originalPrice: plan.originalPrice },
    }, PAYMENT_ORDER_ECHO_KEYS)});
  } catch (e: any) {
    return createOrderFailure(res, e, name, traceId, req.user?.id);
  }
};
