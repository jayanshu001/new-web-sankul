// Client payments: live-course promo preview and create-order handlers.
import { Request, Response } from "express";
import { z } from "zod";
import { findActiveByCode, promoCovers, loadLivePlanDiscountsSql, resolveReferralCode, referralCovers } from "../../modules/promo-code/promo-code.service";
import { computePromoDiscount } from "../promocode/applies-to";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import { getClientIp } from "../../utils/clientIp";
import logger from "../../utils/logger";
import { getErrorMessage, formatZodError } from "../../utils/httpResponse";
import { ZodError } from "zod";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";
import {
  findLiveCoursePlanForOrder,
  findLiveCourse,
  listPlansForLiveCourse,
  createLiveCourseOrderMysql,
} from "../../modules/live-course-order/live-course-order.service";
import { customerAddressRepository } from "../../modules/customer-address/customer-address.repository";
import {
  planIdField, shippingIdField, promocodeField, coinField, requirePaymentCustomer,
  applyOrderPromo, applyOrderWallet, receiptIdFor, promoEcho, createOrderFailure,
} from "./payment-order.shared";

const createOrderSqlSchema = z.object({
  planId: planIdField("Please select a valid plan."),
  promocode: promocodeField,
  withMaterial: z.boolean().optional(),
  customerShippingId: shippingIdField,
  coin: coinField,
});

const applyPromoSqlSchema = z.object({
  planId: z.coerce
    .number({ invalid_type_error: "Please select a valid plan." })
    .int("Please select a valid plan.")
    .positive("Please select a valid plan."),
  promocode: z.string().trim().min(1, "Please enter a promo code."),
});

// Preview only: the discount is re-validated at create-order time.
export const applyLiveCoursePromo = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("applyLiveCoursePromo invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("applyLiveCoursePromo unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // Same shape as POST /client/promocodes/apply: the entity + all its plans,
    // each annotated with the per-plan offer.
    {
      const body = applyPromoSqlSchema.parse(req.body);
      const plan = await findLiveCoursePlanForOrder(body.planId);
      if (!plan) return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
      const liveCourseId = plan.liveCourseId;

      const promo = await findActiveByCode(body.promocode);
      if (!promo) {
        // Not a promocode — try it as a referral code (global % on live course).
        const referral = await resolveReferralCode(body.promocode);
        if (referral && referralCovers("liveCourse")) {
          if (referral.referrerId === Number(customerId)) {
            return res.status(400).json({ success: false, message: "You can't use your own referral code." });
          }
          const rows = await listPlansForLiveCourse(liveCourseId);
          const plans = rows.map((p: any) => {
            const basePrice = Number(p.price);
            const discount = computePromoDiscount({ discountType: referral.discountType, discountValue: referral.discountValue }, basePrice);
            return {
              id: p.id,
              liveCourseId: p.liveCourseId,
              name: p.name ?? null,
              duration: p.duration,
              price: Math.max(0, basePrice - discount),
              originalPrice: p.originalPrice != null ? Number(p.originalPrice) : null,
              withMaterial: !!p.withMaterial,
              materialPrice: p.materialPrice != null ? Number(p.materialPrice) : null,
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
          logger.info("applyLiveCoursePromo success (referral)", { traceId, customerId, liveCourseId, promocode: body.promocode });
          return res.status(200).json({
            success: true,
            data: {
              _id: "",
              promocode: body.promocode.toUpperCase(),
              codeType: "referral",
              discountType: referral.discountType,
              discountValue: referral.discountValue,
              id: liveCourseId,
              key: "liveCourse",
              plans: {
                withMaterial: plans.filter((p: any) => p.withMaterial),
                withoutMaterial: plans.filter((p: any) => !p.withMaterial),
              },
            },
          });
        }
        return res.status(400).json({ success: false, message: "Invalid or expired promo code." });
      }
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

      logger.info("applyLiveCoursePromo success", { traceId, customerId, liveCourseId, promocode: body.promocode });
      return res.status(200).json({
        success: true,
        data: {
          _id: String(promo.id),
          promocode: promo.promocode,
          codeType: "promocode",
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
    if (e instanceof ZodError) {
      logger.warn("applyLiveCoursePromo validation failed", { traceId, customerId, issues: e.issues });
      const { message, errors } = formatZodError(e);
      return res.status(400).json({ success: false, message, errors });
    }
    logger.error("applyLiveCoursePromo failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: "Something went wrong while applying the promo code. Please try again." });
  }
};

// Body: { planId, promocode? }.
export const createLiveCourseOrderPayment = async (req: Request, res: Response) => {
  const name = "createLiveCourseOrderPayment";
  const traceId = req.traceId;
  logger.info(`${name} invoked`, { traceId, path: req.originalUrl, customerId: req.user?.id });

  try {
    const ctx = requirePaymentCustomer(req, res, name);
    if (!ctx) return;
    const { customerId, rp } = ctx;
    const body = createOrderSqlSchema.parse(req.body);
    const planSql = await findLiveCoursePlanForOrder(body.planId);
    if (!planSql) {
      logger.warn(`${name} plan not found/zero-price/inactive`, { traceId, customerId, planId: body.planId });
      return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
    }
    // A disabled live course must not be purchasable even if an active plan still points at it.
    const courseSql = await findLiveCourse(planSql.liveCourseId);
    if (!courseSql || courseSql.status === false) {
      logger.warn(`${name} live course inactive/missing`, { traceId, customerId, liveCourseId: planSql.liveCourseId });
      return res.status(404).json({ success: false, message: "This live course is currently unavailable. Please choose another." });
    }

    // Material belongs to the selected plan; when it ships material, validate the address.
    // ponytail: still stores the address-book id, not a ws_customer_shipping snapshot
    // (see project memory "order shipping id source"); switch to resolveOrderShipping
    // together with the reader side.
    const withMaterialSql = planSql.withMaterial;
    let shippingIdSql: number | null = null;
    if (withMaterialSql && body.customerShippingId) {
      const owned = await customerAddressRepository.findActiveOwned(body.customerShippingId, customerId);
      if (!owned) {
        logger.warn(`${name} address not owned`, { traceId, customerId, customerShippingId: body.customerShippingId });
        return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
      }
      shippingIdSql = body.customerShippingId;
    }

    const promo = await applyOrderPromo(res, ctx, body.promocode, planSql.price, { type: "liveCourse", id: planSql.liveCourseId }, body.planId);
    if (!promo) return;

    // Snapshot the redeemed code into exactly one column (promocode → `promocode`,
    // referral → `refferalcode`; both null when none), same contract as
    // ws_package_course_order. planKind "livePlan" is required: ws_live_course_plan
    // shares an id space with ws_package_course_ebook_price, so "price" would snapshot
    // an unrelated plan and its promoter percentage.
    const codeSnapshot = await buildOrderCodeSnapshots({
      promocodeId: promo.promocodeIdNum,
      referrerId: promo.referrerIdNum,
      planId: body.planId,
      planKind: "livePlan",
    });

    const wallet = await applyOrderWallet(res, ctx, body.coin, planSql.price, promo.chargeAmount);
    if (!wallet) return;
    const { chargeAmount } = wallet;

    const nowSql = new Date();
    const receiptId = receiptIdFor("live", nowSql.getTime());
    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100), currency: "INR", receipt: receiptId,
      notes: { kind: "live-course", liveCourseId: String(planSql.liveCourseId), planId: String(body.planId), customerId: String(customerId), ...(promo.promocodeIdNum ? { promocodeId: String(promo.promocodeIdNum) } : {}) },
    });
    const { orderId } = await createLiveCourseOrderMysql({
      customerId, liveCourseId: planSql.liveCourseId, planId: body.planId,
      amount: chargeAmount, razorpayOrderId: rzpOrder.id, coin: wallet.coin,
      // `originalAmount` stays null when no promo ran; the service falls back to the
      // charged amount so `price` is always the list price, as on package.
      originalAmount: promo.originalAmount,
      uniqueId: receiptId,
      razorpayOrderPayload: JSON.stringify(rzpOrder),
      codeDiscount: promo.discountAmount ?? 0,
      referrerId: promo.referrerIdNum,
      ipAddress: getClientIp(req, 255),
      promocodeSnapshot: codeSnapshot.promocode, refferalcodeSnapshot: codeSnapshot.refferalcode,
      withMaterial: withMaterialSql, customerShippingId: shippingIdSql, now: nowSql,
    });
    logger.info(`${name} success`, { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
    queueCRMLead(
      { params: { userId: customerId, liveCourseId: planSql.liveCourseId, planId: body.planId, amount: chargeAmount }, leadType: CRM_LEAD_TYPE.PAYMENT_MODE },
      { traceId, customerId, orderId }
    );
    return res.status(201).json({
      success: true,
      data: omit({
        // Wire contract: the key stays `subscriptionId` but carries the order id (no
        // subscription exists until verify, which is keyed on razorpay_order_id).
        subscriptionId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: chargeAmount,
        liveCourse: { _id: String(planSql.liveCourseId), name: courseSql.name },
        plan: { _id: String(body.planId), duration: planSql.duration, price: planSql.price },
        promo: promoEcho(promo, chargeAmount),
      }, PAYMENT_ORDER_ECHO_KEYS),
    });
  } catch (e: any) {
    return createOrderFailure(res, e, name, traceId, req.user?.id);
  }
};
