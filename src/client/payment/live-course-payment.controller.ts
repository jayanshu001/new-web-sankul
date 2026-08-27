import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql, findActiveByCode, promoCovers, loadLivePlanDiscountsSql, resolveReferralCode, referralCovers } from "../../modules/promo-code/promo-code.service";
import { resolveWalletUsage } from "../../modules/referral/referral.service";
import { computePromoDiscount } from "../promocode/applies-to";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import { getClientIp } from "../../utils/clientIp";
import logger from "../../utils/logger";
import { getErrorMessage, formatZodError } from "../../utils/httpResponse";
import { ZodError } from "zod";
import {
  findLiveCoursePlanForOrder,
  findLiveCourse,
  listPlansForLiveCourse,
  createLiveCourseOrderMysql,
} from "../../modules/live-course-order/live-course-order.service";
import { customerAddressRepository } from "../../modules/customer-address/customer-address.repository";

// SQL planId is numeric (migrated id-space).
const createOrderSqlSchema = z.object({
  planId: z.coerce
    .number({ invalid_type_error: "Please select a valid plan." })
    .int("Please select a valid plan.")
    .positive("Please select a valid plan."),
  promocode: z.string().trim().min(1, "Promo code cannot be empty. Remove it or enter a valid code.").optional(),
  withMaterial: z.boolean().optional(),
  customerShippingId: z.coerce
    .number({ invalid_type_error: "Please select a valid delivery address." })
    .int("Please select a valid delivery address.")
    .positive("Please select a valid delivery address.")
    .optional(),
  coin: z.coerce
    .number({ invalid_type_error: "Coins to redeem must be a whole number." })
    .int("Coins to redeem must be a whole number.")
    .min(0, "Coins to redeem cannot be negative.")
    .optional(),
});

// SQL variant: planId is a numeric id (migrated id-space).
const applyPromoSqlSchema = z.object({
  planId: z.coerce
    .number({ invalid_type_error: "Please select a valid plan." })
    .int("Please select a valid plan.")
    .positive("Please select a valid plan."),
  promocode: z.string().trim().min(1, "Please enter a promo code."),
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

      logger.info("applyLiveCoursePromo success (sql)", { traceId, customerId, liveCourseId, promocode: body.promocode });
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
        logger.warn("createLiveCourseOrderPayment[mysql] plan not found/zero-price/inactive", { traceId, customerId, planId: body.planId });
        return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
      }
      // Gate on the parent live course being active — a disabled live course must
      // not be purchasable even if an active plan row still points at it.
      const courseSql = await findLiveCourse(planSql.liveCourseId);
      if (!courseSql || courseSql.status === false) {
        logger.warn("createLiveCourseOrderPayment[mysql] live course inactive/missing", { traceId, customerId, liveCourseId: planSql.liveCourseId });
        return res.status(404).json({ success: false, message: "This live course is currently unavailable. Please choose another." });
      }

      // Material is a property of the selected PLAN (mirrors Course/Package).
      // When the plan ships material, accept + validate the delivery address.
      const withMaterialSql = planSql.withMaterial;
      let shippingIdSql: number | null = null;
      if (withMaterialSql && body.customerShippingId) {
        const owned = await customerAddressRepository.findActiveOwned(body.customerShippingId, customerIdInt);
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
      let referrerIdNum: number | null = null;
      if (body.promocode) {
        const { result, error } = await resolvePromoForPlanSql(body.promocode, planSql.price, { type: "liveCourse", id: planSql.liveCourseId }, body.planId, customerIdInt);
        if (error || !result) return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
        if (result.finalAmount < 1) return res.status(400).json({ success: false, message: "This promo code reduces the price below the minimum payable amount. Please contact support." });
        chargeAmount = result.finalAmount;
        const pid = Number(String(result.promo._id));
        promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
        originalAmount = result.originalAmount;
        discountAmount = result.discountAmount;
        referrerIdNum = result.referrerId ?? null;
      }

      // Freeze the redeemed code into the subscription as the snapshot OBJECT, routed
      // to exactly ONE column: a real promocode → `promocode`, a customer referral
      // code → `refferalcode`. Same contract as ws_package_course_order, so the
      // live-course subscription report can render the code + promoter, and the same
      // JSON paths resolve. Both null when no code was applied.
      //
      // planKind "livePlan" is REQUIRED: body.planId is a ws_live_course_plan id, and
      // that table shares an id space with ws_package_course_ebook_price. Defaulting
      // to "price" here would snapshot an unrelated course/package plan and its
      // promoter percentage (see order-code-snapshot.repository.findPlanLink).
      const codeSnapshot = await buildOrderCodeSnapshots({
        promocodeId: promocodeIdNum,
        referrerId: referrerIdNum,
        planId: body.planId,
        planKind: "livePlan",
      });

      // Wallet ("coin") redemption — validate + reduce the charged amount (debited at verify).
      const walletUsage = await resolveWalletUsage(customerIdInt, body.coin, planSql.price);
      if (walletUsage.error) {
        logger.warn("createLiveCourseOrderPayment[mysql] wallet rejected", { traceId, customerId, coin: body.coin, error: walletUsage.error });
        return res.status(400).json({ success: false, message: walletUsage.error });
      }
      if (walletUsage.coin > 0) {
        chargeAmount = chargeAmount - walletUsage.coin;
        if (chargeAmount < 1) return res.status(400).json({ success: false, message: "Amount after discount and wallet is below the minimum payable. Please reduce wallet usage." });
      }

      const nowSql = new Date();
      const receiptId = `live-${nowSql.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
      const rzpOrder = await createRazorpayOrder(rp, {
        amount: Math.round(chargeAmount * 100), currency: "INR", receipt: receiptId,
        notes: { kind: "live-course", liveCourseId: String(planSql.liveCourseId), planId: String(body.planId), customerId: String(customerIdInt), ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}) },
      });
      const { orderId } = await createLiveCourseOrderMysql({
        customerId: customerIdInt, liveCourseId: planSql.liveCourseId, planId: body.planId,
        amount: chargeAmount, razorpayOrderId: rzpOrder.id, coin: walletUsage.coin,
        // Since 2026-08-27 this table has the ws_package_course_order columns, so the
        // four values this checkout already computed but had nowhere to put are
        // persisted — same wiring as createPackageOrderMysql:
        //   receiptId  → unique_id      (the id already returned to the client)
        //   rzpOrder   → razorpay_order (the full gateway response)
        //   discountAmount → code_discount (stored now, no longer derived)
        //   referrerIdNum  → referrer_id   (was only inside the refferalcode snapshot)
        // `originalAmount` stays null when no promo ran; the service falls back to the
        // charged amount so `price` is ALWAYS the list price, as on package.
        originalAmount,
        uniqueId: receiptId,
        razorpayOrderPayload: JSON.stringify(rzpOrder),
        codeDiscount: discountAmount ?? 0,
        referrerId: referrerIdNum,
        ipAddress: getClientIp(req, 255),
        promocodeSnapshot: codeSnapshot.promocode, refferalcodeSnapshot: codeSnapshot.refferalcode,
        withMaterial: withMaterialSql, customerShippingId: shippingIdSql, now: nowSql,
      });
      logger.info("createLiveCourseOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
      return res.status(201).json({
        success: true,
        data: omit({
          // WIRE CONTRACT: the key stays `subscriptionId`. Since 2026-08-25 checkout
          // creates an ORDER (no subscription exists until payment verifies), so this
          // now carries the order id. The app only echoes it back / logs it — verify
          // is keyed on razorpay_order_id — so the rename stayed server-side.
          subscriptionId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: chargeAmount,
          liveCourse: { _id: String(planSql.liveCourseId), name: courseSql.name },
          plan: { _id: String(body.planId), duration: planSql.duration, price: planSql.price },
          promo: promocodeIdNum ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount } : null,
        }, PAYMENT_ORDER_ECHO_KEYS),
      });
    }
  } catch (e: any) {
    if (e instanceof ZodError) {
      logger.warn("createLiveCourseOrderPayment validation failed", { traceId, customerId, issues: e.issues });
      const { message, errors } = formatZodError(e);
      return res.status(400).json({ success: false, message, errors });
    }
    logger.error("createLiveCourseOrderPayment failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e?.error?.description || "Something went wrong while creating your order. Please try again." });
  }
};
