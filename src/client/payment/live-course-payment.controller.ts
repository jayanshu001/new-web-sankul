import { Request, Response } from "express";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { resolveLivePromo } from "../live-course/promo";
import { validateCoin } from "../referral/wallet-debit";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createOrderSchema = z.object({
  // LiveCoursePlan._id — single source of truth for price/duration.
  planId: objectId,
  // Optional. When present, a promo-level discount is applied to the plan
  // price and the Razorpay order is created for the reduced amount.
  promocode: z.string().trim().min(1).optional(),
  // Optional "With Materials" support. `customerShippingId` is a delivery
  // address (CustomerAddress._id), validated for ownership only when sent;
  // `withMaterial` marks the order as shipping physical material. Both optional
  // so existing callers are unaffected. (LiveCoursePlan carries no material
  // flag, so withMaterial comes from the request rather than the plan.)
  withMaterial: z.boolean().optional(),
  customerShippingId: objectId.optional(),
  // Optional wallet ("coin") amount in rupees. Validated (≤ balance, ≤ 50% of
  // plan price), subtracted from the charge, debited at /verify success.
  coin: z.number().int().min(0).optional(),
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
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("applyLiveCoursePromo invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("applyLiveCoursePromo unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { planId, promocode } = applyPromoSchema.parse(req.body);

    const plan = await LiveCoursePlan.findOne({ _id: planId, status: true });
    if (!plan) { logger.warn("applyLiveCoursePromo plan not found", { traceId, customerId, planId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("applyLiveCoursePromo zero price", { traceId, customerId, planId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — promo codes don't apply.",
      });
    }

    const { result, error } = await resolveLivePromo(promocode, plan.price, {
      type: "liveCourse",
      id: String(plan.liveCourseId),
    }, String(plan._id), customerId);
    if (error || !result) {
      logger.warn("applyLiveCoursePromo promo rejected", { traceId, customerId, planId, promocode, error });
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }

    logger.info("applyLiveCoursePromo success", { traceId, customerId, planId, promocode, finalAmount: result.finalAmount, isReferral: !!result.referrerId });
    return res.status(200).json({
      success: true,
      data: {
        planId: String(plan._id),
        liveCourseId: String(plan.liveCourseId),
        // For a referral code, echo the code itself (there's no promocode doc).
        promocode: result.promo ? result.promo.promocode : promocode.trim().toUpperCase(),
        promocodeId: result.promo ? String(result.promo._id) : null,
        // Marks a referral redemption so the FE can label "Referral discount".
        isReferral: !!result.referrerId,
        discountType: result.discountType,
        discountValue: result.discountValue,
        originalAmount: result.originalAmount,
        discountAmount: result.discountAmount,
        finalAmount: result.finalAmount,
        // Per-plan applicability flags — same contract as /promocodes/apply.
        // This endpoint is single-plan, so a reachable success is always
        // applicable; out-of-scope/invalid plans are rejected with a 400 above.
        offerApplicable: true,
        offerReason: null,
      },
    });
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

    const { planId, promocode, withMaterial, customerShippingId, coin: coinRaw } = createOrderSchema.parse(req.body);

    if (customerShippingId) {
      const addr = await CustomerAddress.findOne({ _id: customerShippingId, customerId }).select("_id");
      if (!addr) {
        logger.warn("createLiveCourseOrderPayment address not owned", { traceId, customerId, customerShippingId });
        return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
      }
    }

    const plan = await LiveCoursePlan.findOne({ _id: planId, status: true });
    if (!plan) { logger.warn("createLiveCourseOrderPayment plan not found", { traceId, customerId, planId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("createLiveCourseOrderPayment zero price", { traceId, customerId, planId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const course = await LiveCourse.findOne({ _id: plan.liveCourseId, status: true });
    if (!course) { logger.warn("createLiveCourseOrderPayment course not found", { traceId, customerId, liveCourseId: plan.liveCourseId }); return res.status(404).json({ success: false, message: "Live course not found or inactive." }); }

    // Re-purchasing an active live course is an "Extend Validity" action, NOT a
    // double-buy error. We create a fresh pending row regardless; /payment/verify
    // folds the purchased window onto the existing active subscription (extending
    // its endAt) and retires this row. See verify.controller live-course branch.

    // Resolve the promo code (if any) and derive the amount to charge. The
    // discount is always re-validated here — the preview endpoint's result is
    // never trusted.
    let chargeAmount = plan.price;
    let promocodeId: string | null = null;
    let originalAmount: number | null = null;
    let discountAmount: number | null = null;
    let promoterId: string | null = null;
    let promoterPercentage: number | null = null;
    let promoterCommission: number | null = null;
    let referrerId: string | null = null;
    let customerPercentage: number | null = null;

    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price, {
        type: "liveCourse",
        id: String(plan.liveCourseId),
      }, String(plan._id), customerId);
      if (error || !result) {
        logger.warn("createLiveCourseOrderPayment promo rejected", { traceId, customerId, promocode, error });
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      // Razorpay rejects sub-₹1 orders; a code that zeroes the price can't go
      // through online checkout — admin should free-grant instead.
      if (result.finalAmount < 1) {
        logger.warn("createLiveCourseOrderPayment promo zeroes amount", { traceId, customerId, promocode });
        return res.status(400).json({
          success: false,
          message:
            "This promo code reduces the price below the minimum payable amount. Please contact support.",
        });
      }
      chargeAmount = result.finalAmount;
      originalAmount = result.originalAmount;
      discountAmount = result.discountAmount;
      // promo is null on the referral path; referrerId is set instead. The
      // referrer is credited at verify/webhook time via creditReferrer.
      promocodeId = result.promo ? String(result.promo._id) : null;
      promoterId = result.promo?.promoterId ? String(result.promo.promoterId) : null;
      promoterPercentage = result.promoterPercentage;
      promoterCommission = result.promoterCommission;
      referrerId = result.referrerId ? String(result.referrerId) : null;
      customerPercentage = result.customerPercentage;
    }

    // Wallet ("coin"): validate + subtract. Recorded now, debited at /verify.
    const coinCheck = await validateCoin(customerId, plan.price, coinRaw);
    if ("error" in coinCheck) {
      logger.warn("createLiveCourseOrderPayment coin rejected", { traceId, customerId, coin: coinRaw, error: coinCheck.error });
      return res.status(400).json({ success: false, message: coinCheck.error });
    }
    const coinsUsed = coinCheck.coin;
    chargeAmount = Math.max(0, chargeAmount - coinsUsed);
    if (chargeAmount < 1) {
      logger.warn("createLiveCourseOrderPayment amount below minimum after wallet", { traceId, customerId, planId });
      return res.status(400).json({
        success: false,
        message: "Amount after discount and wallet is below the minimum payable. Please reduce wallet usage.",
      });
    }

    const subscription = await LiveCourseSubscription.create({
      customerId,
      liveCourseId: plan.liveCourseId,
      planId: plan._id,
      promocodeId,
      promoterId,
      promoterPercentage,
      promoterCommission,
      referrerId,
      customerPercentage,
      coinsUsed,
      originalAmount,
      discountAmount,
      paidAmount: chargeAmount,
      paymentStatus: "pending",
      status: true,
      withMaterial: !!withMaterial,
      customerShippingId: customerShippingId ?? null,
    });

    const receiptId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
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

    logger.info("createLiveCourseOrderPayment success", { traceId, customerId, subscriptionId: subscription._id, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
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
    if (e.issues) { logger.warn("createLiveCourseOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("createLiveCourseOrderPayment failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
