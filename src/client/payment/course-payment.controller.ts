// Client payments: course create-order (promo, wallet, shipping snapshot, Razorpay).
import { Request, Response } from "express";
import { z } from "zod";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import logger from "../../utils/logger";
import {
  createCourseOrderMysql,
  findCoursePlanForOrder,
} from "../../modules/commerce-order/commerce-order.service";
import { findCourseById } from "../../modules/catalog-course/catalog-course.service";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";
import {
  planIdField, shippingIdField, promocodeField, coinField, requirePaymentCustomer, resolveOrderShipping,
  applyOrderPromo, applyOrderWallet, receiptIdFor, promoEcho,
} from "./payment-order.shared";

// The plan id is a positive INT (number or numeric string).
const createCourseOrderMysqlSchema = z.object({
  packageId: planIdField("Please select a valid plan."),
  customerShippingId: shippingIdField,
  promocode: promocodeField,
  coin: coinField,
});

// Writes a pending order + Razorpay order; /verify grants access. `subscriptionId` in
// the response is the ORDER id; the entitlement subscription row is created at verify
// time. The client only round-trips the razorpay order id.
export const createCourseOrderPayment = async (req: Request, res: Response) => {
  const name = "createCourseOrderPayment";
  const traceId = req.traceId;
  logger.info(`${name} invoked`, { traceId, path: req.originalUrl, customerId: req.user?.id });

  try {
    const ctx = requirePaymentCustomer(req, res, name);
    if (!ctx) return;
    const { customerId, rp } = ctx;
    const { packageId, customerShippingId, promocode, coin } = createCourseOrderMysqlSchema.parse(req.body);

    const plan = await findCoursePlanForOrder(packageId);
    if (!plan) {
      logger.warn(`${name} plan invalid/inactive`, { traceId, customerId, packageId });
      return res.status(404).json({
        success: false,
        message: "This plan is currently unavailable. Please choose another plan.",
      });
    }

    const course = await findCourseById(plan.courseId);
    if (!course) {
      logger.warn(`${name} course not found`, { traceId, customerId, courseId: plan.courseId });
      return res.status(404).json({ success: false, message: "Course not found or inactive." });
    }

    const shipping = await resolveOrderShipping(res, ctx, customerShippingId);
    if (!shipping) return;

    const promo = await applyOrderPromo(res, ctx, promocode, plan.price, { type: "course", id: plan.courseId }, packageId);
    if (!promo) return;

    // Freeze the redeemed code into the order as a snapshot object in exactly one column:
    // promocode → `promocode`, referral code → `refferalcode`. promoter-data reads these
    // by JSON path to attribute commission, so the object (not the bare code) is required.
    const codeSnapshot = await buildOrderCodeSnapshots({
      promocodeId: promo.promocodeIdNum,
      referrerId: promo.referrerIdNum,
      planId: packageId,
    });

    const wallet = await applyOrderWallet(res, ctx, coin, plan.price, promo.chargeAmount);
    if (!wallet) return;
    const { chargeAmount } = wallet;

    const receiptId = receiptIdFor("course");
    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "course",
        courseId: String(plan.courseId),
        packageId: String(packageId),
        customerId: String(customerId),
        ...(promo.promocodeIdNum ? { promocodeId: String(promo.promocodeIdNum) } : {}),
      },
    });

    // `price` is the charged amount (→ discount_price); list price and code discount are
    // passed separately so the row keeps: price − code_discount − ws_coin = discount_price.
    const { orderId } = await createCourseOrderMysql({
      customerId,
      planId: packageId,
      price: chargeAmount,
      originalPrice: plan.price,
      codeDiscount: promo.discountAmount ?? 0,
      promoCode: codeSnapshot.promocode,
      referralCode: codeSnapshot.refferalcode,
      razorpayOrderId: rzpOrder.id,
      uniqueId: receiptId,
      razorpayOrderPayload: JSON.stringify(rzpOrder),
      customerShippingId: shipping.shippingId,
      referrerId: promo.referrerIdNum,
      coin: wallet.coin,
    });

    logger.info(`${name} success`, { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
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
        promo: promoEcho(promo, chargeAmount),
      }, PAYMENT_ORDER_ECHO_KEYS),
    });
  } catch (e: any) {
    // Response contract: course/ebook errors (validation included) have always gone to
    // errorHandler (which logs them) and its envelope, not createOrderFailure's.
    throw e;
  }
};
