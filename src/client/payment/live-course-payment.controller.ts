import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql, findActiveByCode, promoCovers, loadLivePlanDiscountsSql } from "../../modules/promo-code/promo-code.service";
import { computePromoDiscount } from "../promocode/applies-to";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  findLiveCoursePlanForOrder,
  findLiveCourse,
  listPlansForLiveCourse,
  createLiveCourseOrderMysql,
} from "../../modules/live-course-order/live-course-order.service";
import { customerAddressRepository } from "../../modules/customer-address/customer-address.repository";

// SQL planId is numeric (migrated id-space).
const createOrderSqlSchema = z.object({
  planId: z.coerce.number().int().positive(),
  promocode: z.string().trim().min(1).optional(),
  withMaterial: z.boolean().optional(),
  customerShippingId: z.coerce.number().int().positive().optional(),
});

// SQL variant: planId is a numeric id (migrated id-space).
const applyPromoSqlSchema = z.object({
  planId: z.coerce.number().int().positive(),
  promocode: z.string().trim().min(1),
});

// POST /api/v1/client/payment/apply-promo/live-course
// Preview-only: validates a promo code against a plan and returns the price
// breakdown. The discount is re-validated server-side at create-order time —
// this endpoint is purely so the UI can show the final price before checkout.
export const applyLiveCoursePromo = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("applyLiveCoursePromo invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("applyLiveCoursePromo unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ── MySQL live-course promo preview (live-course-order flag) ──────────────
    // Returns the SAME shape as POST /client/promocodes/apply: the entity + ALL
    // its pricing plans, each annotated with the per-plan offer.
    {
      const body = applyPromoSqlSchema.parse(req.body);
      const plan = await findLiveCoursePlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan not found, inactive, or zero price." });
      const liveCourseId = plan.liveCourseId;

      const promo = await findActiveByCode(body.promocode);
      if (!promo) return res.status(400).json({ success: false, message: "Invalid or expired promo code." });
      if (!promoCovers(promo, { type: "liveCourse", id: liveCourseId })) {
        return res.status(404).json({ success: false, message: "This promocode is not applicable for this item." });
      }

      const promoDiscountType = promo.discountType as "flat" | "percentage";
      const promoDiscountValue = Number(promo.discountValue ?? 0);
      const planDiscounts = await loadLivePlanDiscountsSql(promo.id);
      const hasLinks = planDiscounts.size > 0;
      if (!hasLinks && !(promoDiscountValue > 0)) {
        return res.status(400).json({ success: false, message: "This promocode has no discount configured." });
      }

      const rows = await listPlansForLiveCourse(liveCourseId);
      let matchedAny = false;
      const plans = rows.map((p: any) => {
        const basePrice = Number(p.price);
        const out: any = {
          id: p.id,
          liveCourseId: p.liveCourseId,
          name: p.name ?? null,
          duration: p.duration,
          price: basePrice,
          originalPrice: p.originalPrice != null ? Number(p.originalPrice) : null,
          withMaterial: !!p.withMaterial,
          materialPrice: p.materialPrice != null ? Number(p.materialPrice) : null,
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

      logger.info("applyLiveCoursePromo success (sql)", { traceId, customerId, liveCourseId, promocode: body.promocode });
      return res.status(200).json({
        success: true,
        data: {
          _id: String(promo.id),
          promocode: promo.promocode,
          discountType: promoDiscountType,
          discountValue: promoDiscountValue,
          id: liveCourseId,
          key: "liveCourse",
          plans: {
            withMaterial: plans.filter((p: any) => p.withMaterial),
            withoutMaterial: plans.filter((p: any) => !p.withMaterial),
          },
        },
      });
    }
  } catch (e: any) {
    if (e.issues) { logger.warn("applyLiveCoursePromo validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("applyLiveCoursePromo failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/payment/create-order/live-course
// Mirrors createCourseOrderPayment but writes to LiveCourseSubscription so the
// existing course flow stays isolated. Body: { planId, promocode? }.
export const createLiveCourseOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createLiveCourseOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createLiveCourseOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createLiveCourseOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    // ── MySQL live-course write path (live-course-order) ─────────────────────
    // Single-table design: createPending writes a pending ws_live_course_subscription
    // row; /payment/verify (or the webhook) flips it to verified or folds it onto an
    // existing active sub.
    {
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) {
        logger.warn("createLiveCourseOrderPayment[mysql] non-int customer id", { traceId, customerId });
        return res.status(400).json({ success: false, message: "Invalid customer id." });
      }
      const body = createOrderSqlSchema.parse(req.body);
      const planSql = await findLiveCoursePlanForOrder(body.planId);
      if (!planSql) {
        logger.warn("createLiveCourseOrderPayment[mysql] plan not found/zero-price", { traceId, customerId, planId: body.planId });
        return res.status(404).json({ success: false, message: "Plan not found, inactive, or zero price." });
      }
      const courseSql = await findLiveCourse(planSql.liveCourseId);

      // Material is a property of the selected PLAN (mirrors Course/Package).
      // When the plan ships material, accept + validate the delivery address.
      const withMaterialSql = planSql.withMaterial;
      let shippingIdSql: number | null = null;
      if (withMaterialSql && body.customerShippingId) {
        const owned = await customerAddressRepository.findOwned(body.customerShippingId, customerIdInt);
        if (!owned) {
          logger.warn("createLiveCourseOrderPayment[mysql] address not owned", { traceId, customerId, customerShippingId: body.customerShippingId });
          return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
        }
        shippingIdSql = body.customerShippingId;
      }

      let chargeAmount = planSql.price;
      let promocodeIdNum: number | null = null;
      let originalAmount: number | null = null;
      let discountAmount: number | null = null;
      if (body.promocode) {
        const { result, error } = await resolvePromoForPlanSql(body.promocode, planSql.price, { type: "liveCourse", id: planSql.liveCourseId }, body.planId);
        if (error || !result) return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
        if (result.finalAmount < 1) return res.status(400).json({ success: false, message: "This promo code reduces the price below the minimum payable amount. Please contact support." });
        chargeAmount = result.finalAmount;
        const pid = Number(String(result.promo._id));
        promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
        originalAmount = result.originalAmount;
        discountAmount = result.discountAmount;
      }

      const nowSql = new Date();
      const receiptId = `live-${nowSql.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
      const rzpOrder = await createRazorpayOrder(rp, {
        amount: Math.round(chargeAmount * 100), currency: "INR", receipt: receiptId,
        notes: { kind: "live-course", liveCourseId: String(planSql.liveCourseId), planId: String(body.planId), customerId: String(customerIdInt), ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}) },
      });
      const { subscriptionId } = await createLiveCourseOrderMysql({
        customerId: customerIdInt, liveCourseId: planSql.liveCourseId, planId: body.planId,
        amount: chargeAmount, razorpayOrderId: rzpOrder.id, promocodeId: promocodeIdNum, originalAmount, discountAmount,
        withMaterial: withMaterialSql, customerShippingId: shippingIdSql, now: nowSql,
      });
      logger.info("createLiveCourseOrderPayment[mysql] success", { traceId, customerId, subscriptionId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
      return res.status(201).json({
        success: true,
        data: {
          subscriptionId: String(subscriptionId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: chargeAmount,
          liveCourse: courseSql ? { _id: String(planSql.liveCourseId), name: (courseSql as any).name } : { _id: String(planSql.liveCourseId), name: null },
          plan: { _id: String(body.planId), duration: planSql.duration, price: planSql.price },
          promo: promocodeIdNum ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount } : null,
        },
      });
    }
  } catch (e: any) {
    if (e.issues) { logger.warn("createLiveCourseOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("createLiveCourseOrderPayment failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
