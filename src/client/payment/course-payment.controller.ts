// Client payments: course create-order (promo, wallet, shipping snapshot, Razorpay).
import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql } from "../../modules/promo-code/promo-code.service";
import { resolveShippingIdForAddress } from "../../modules/customer-shipping/customer-shipping.service";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { resolveWalletUsage } from "../../modules/referral/referral.service";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import logger from "../../utils/logger";
import { getErrorMessage, formatZodError } from "../../utils/httpResponse";
import { ZodError } from "zod";
import {
  createCourseOrderMysql,
  findCoursePlanForOrder,
} from "../../modules/commerce-order/commerce-order.service";
import { findCourseById } from "../../modules/catalog-course/catalog-course.service";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;

// The plan id is a positive INT (number or numeric string).
const createCourseOrderMysqlSchema = z.object({
  packageId: z.coerce
    .number({ invalid_type_error: "Please select a valid plan." })
    .int("Please select a valid plan.")
    .positive("Please select a valid plan."),
  customerShippingId: z.coerce
    .number({ invalid_type_error: "Please select a valid delivery address." })
    .int("Please select a valid delivery address.")
    .positive("Please select a valid delivery address.")
    .optional(),
  promocode: z.string().trim().min(1, "Promo code cannot be empty. Remove it or enter a valid code.").optional(),
  coin: z.coerce
    .number({ invalid_type_error: "Coins to redeem must be a whole number." })
    .int("Coins to redeem must be a whole number.")
    .min(0, "Coins to redeem cannot be negative.")
    .optional(),
});

// Writes a pending order + Razorpay order; /verify grants access.
export const createCourseOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createCourseOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createCourseOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createCourseOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    // The token subject is a string; the order tables key on the int customer id.
    const customerIdInt = Number(customerId);
    if (!Number.isInteger(customerIdInt)) {
      logger.warn("createCourseOrderPayment[mysql] non-int customer id", { traceId, customerId });
      return res.status(400).json({ success: false, message: "Invalid customer id." });
    }
    return createCourseOrderMysqlPath(req, res, { traceId, customerId: customerIdInt, rp });
  } catch (e: any) {
    if (e instanceof ZodError) {
      logger.warn("createCourseOrderPayment validation failed", { traceId, customerId, issues: e.issues });
      const { message, errors } = formatZodError(e);
      return res.status(400).json({ success: false, message, errors });
    }
    logger.error("createCourseOrderPayment failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e?.error?.description || "Something went wrong while creating your order. Please try again." });
  }
};

// `subscriptionId` in the response is the ORDER id; the entitlement subscription row
// is created at verify time. The client only round-trips the razorpay order id.
const createCourseOrderMysqlPath = async (
  req: Request,
  res: Response,
  ctx: { traceId?: string; customerId: number; rp: RazorpayClient }
) => {
  const { traceId, customerId, rp } = ctx;
  const { packageId, customerShippingId, promocode, coin } = createCourseOrderMysqlSchema.parse(req.body);

  const plan = await findCoursePlanForOrder(packageId);
  if (!plan) {
    logger.warn("createCourseOrderPayment[mysql] plan invalid/inactive", { traceId, customerId, packageId });
    return res.status(404).json({
      success: false,
      message: "This plan is currently unavailable. Please choose another plan.",
    });
  }

  const course = await findCourseById(plan.courseId);
  if (!course) {
    logger.warn("createCourseOrderPayment[mysql] course not found", { traceId, customerId, courseId: plan.courseId });
    return res.status(404).json({ success: false, message: "Course not found or inactive." });
  }

  // The request carries an address-book id (ws_customer_address), but the order's
  // `shipping` column is an FK to ws_customer_shipping, so snapshot the address into a
  // shipping row and persist that id. Resolving also proves ownership (not-found covers
  // unknown, soft-deleted and other customers' ids).
  let shippingIdSql: number | null = null;
  if (customerShippingId) {
    const resolved = await resolveShippingIdForAddress(customerId, customerShippingId);
    if (!resolved.ok) {
      logger.warn("createCourseOrderPayment[mysql] shipping resolve failed", { traceId, customerId, customerShippingId, reason: resolved.reason });
      return res.status(400).json({
        success: false,
        message:
          resolved.reason === "address_not_found"
            ? "Delivery address does not belong to this customer."
            : "Delivery address is incomplete. Please update it and try again.",
      });
    }
    shippingIdSql = resolved.shippingId;
  }

  // Re-validated here; the /promocodes/apply preview is never trusted.
  let chargeAmount = plan.price;
  let promocodeIdNum: number | null = null;
  let originalAmount: number | null = null;
  let discountAmount: number | null = null;
  let referrerIdNum: number | null = null;
  if (promocode) {
    const { result, error } = await resolvePromoForPlanSql(promocode, plan.price, { type: "course", id: plan.courseId }, packageId, Number(customerId));
    if (error || !result) {
      logger.warn("createCourseOrderPayment[mysql] promo rejected", { traceId, customerId, promocode, error });
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }
    if (result.finalAmount < 1) return res.status(400).json({ success: false, message: "This promo code reduces the price below the minimum payable amount. Please contact support." });
    chargeAmount = result.finalAmount;
    const pid = Number(result.promo._id);
    promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
    originalAmount = result.originalAmount;
    discountAmount = result.discountAmount;
    // Referral code (not a promocode) → stamp the referrer so verify can credit.
    referrerIdNum = result.referrerId ?? null;
  }

  // Freeze the redeemed code into the order as a snapshot object in exactly one column:
  // promocode → `promocode`, referral code → `refferalcode`. promoter-data reads these
  // by JSON path to attribute commission, so the object (not the bare code) is required.
  const codeSnapshot = await buildOrderCodeSnapshots({
    promocodeId: promocodeIdNum,
    referrerId: referrerIdNum,
    planId: packageId,
  });

  // Wallet coins: validated against balance + 50%-of-plan-price cap. They are debited
  // at verify, so the order stores the coin amount.
  const walletUsage = await resolveWalletUsage(Number(customerId), coin, plan.price);
  if (walletUsage.error) {
    logger.warn("createCourseOrderPayment[mysql] wallet rejected", { traceId, customerId, coin, error: walletUsage.error });
    return res.status(400).json({ success: false, message: walletUsage.error });
  }
  if (walletUsage.coin > 0) {
    chargeAmount = chargeAmount - walletUsage.coin;
    if (chargeAmount < 1) return res.status(400).json({ success: false, message: "Amount after discount and wallet is below the minimum payable. Please reduce wallet usage." });
  }

  const receiptId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rzpOrder = await createRazorpayOrder(rp, {
    amount: Math.round(chargeAmount * 100), // paise
    currency: "INR",
    receipt: receiptId,
    notes: {
      kind: "course",
      courseId: String(plan.courseId),
      packageId: String(packageId),
      customerId: String(customerId),
      ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}),
    },
  });

  // `price` is the charged amount (→ discount_price); list price and code discount are
  // passed separately so the row keeps: price − code_discount − ws_coin = discount_price.
  const { orderId } = await createCourseOrderMysql({
    customerId,
    planId: packageId,
    price: chargeAmount,
    originalPrice: plan.price,
    codeDiscount: discountAmount ?? 0,
    promoCode: codeSnapshot.promocode,
    referralCode: codeSnapshot.refferalcode,
    razorpayOrderId: rzpOrder.id,
    uniqueId: receiptId,
    razorpayOrderPayload: JSON.stringify(rzpOrder),
    customerShippingId: shippingIdSql,
    referrerId: referrerIdNum,
    coin: walletUsage.coin,
  });

  logger.info("createCourseOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
  queueCRMLead(
    { params: { userId: customerId, courseId: plan.courseId, planId: packageId, amount: chargeAmount }, leadType: CRM_LEAD_TYPE.PAYMENT_MODE },
    { traceId, customerId, orderId }
  );
  return res.status(201).json({
    success: true,
    data: omit({
      subscriptionId: String(orderId),
      receiptId,
      razorpay: razorpayResponseFor(rzpOrder),
      amountInRupees: chargeAmount,
      course: {
        _id: course._id,
        name: course.name,
      },
      plan: {
        _id: String(packageId),
        duration: plan.duration,
        price: plan.price,
      },
      promo: promocodeIdNum
        ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount }
        : null,
    }, PAYMENT_ORDER_ECHO_KEYS),
  });
};
