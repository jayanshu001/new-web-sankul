// Client payments: package create-order (promo, wallet, shipping snapshot, Razorpay).
import { Request, Response } from "express";
import { z } from "zod";
import { razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import logger from "../../utils/logger";
import { findActivePackageRef } from "../../modules/catalog-package/catalog-package.detail.sql";
import {
  findPackagePlanForOrder,
  createPackageOrderMysql,
} from "../../modules/commerce-order/commerce-order.service";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";
import {
  planIdField, shippingIdField, promocodeField, coinField, requirePaymentCustomer, resolveOrderShipping,
  applyOrderPromo, applyOrderWallet, receiptIdFor, promoEcho, createOrderFailure,
} from "./payment-order.shared";

const createPackageOrderSqlSchema = z.object({
  packageId: planIdField("Please select a valid plan."),
  customerShippingId: shippingIdField,
  promocode: promocodeField,
  coin: coinField,
});

// Like /create-order/course but for plan rows with `packageId` set. Writes only the
// pending ws_package_course_order row + Razorpay order; /payment/verify creates the subscription.
export const createPackageOrderPayment = async (req: Request, res: Response) => {
  const name = "createPackageOrderPayment";
  const traceId = req.traceId;
  logger.info(`${name} invoked`, { traceId, path: req.originalUrl, customerId: req.user?.id });

  try {
    const ctx = requirePaymentCustomer(req, res, name);
    if (!ctx) return;
    const { customerId, rp } = ctx;
    const body = createPackageOrderSqlSchema.parse(req.body);

    const shipping = await resolveOrderShipping(res, ctx, body.customerShippingId);
    if (!shipping) return;
    const planSql = await findPackagePlanForOrder(body.packageId);
    if (!planSql) {
      logger.warn(`${name} plan invalid/not-package/zero/inactive`, { traceId, customerId, packageId: body.packageId });
      return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
    }
    // A disabled package must not be purchasable even if a stale plan row points at it.
    const pkgSql = await findActivePackageRef(planSql.packageId);
    if (!pkgSql) {
      logger.warn(`${name} package inactive/missing`, { traceId, customerId, targetPackageId: planSql.packageId });
      return res.status(404).json({ success: false, message: "This package is currently unavailable. Please choose another." });
    }

    const promo = await applyOrderPromo(res, ctx, body.promocode, planSql.price, { type: "package", id: planSql.packageId }, body.packageId);
    if (!promo) return;

    // Freeze the redeemed code as the snapshot OBJECT in exactly one column
    // (promocode vs refferalcode); promoter-data attributes commission by JSON path over it.
    const codeSnapshot = await buildOrderCodeSnapshots({
      promocodeId: promo.promocodeIdNum,
      referrerId: promo.referrerIdNum,
      planId: body.packageId,
    });

    const wallet = await applyOrderWallet(res, ctx, body.coin, planSql.price, promo.chargeAmount);
    if (!wallet) return;
    const { chargeAmount } = wallet;

    const receiptId = receiptIdFor("package");
    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100), currency: "INR", receipt: receiptId,
      notes: { kind: "package", targetPackageId: String(planSql.packageId), packageId: String(body.packageId), customerId: String(customerId), ...(promo.promocodeIdNum ? { promocodeId: String(promo.promocodeIdNum) } : {}) },
    });
    // Order row keeps the full breakdown:
    //   price (list) − code_discount (promo/referral) − ws_coin = discount_price (paid)
    const { orderId } = await createPackageOrderMysql({ customerId, planId: body.packageId, price: chargeAmount, originalPrice: planSql.price, codeDiscount: promo.discountAmount ?? 0, promoCode: codeSnapshot.promocode, referralCode: codeSnapshot.refferalcode, razorpayOrderId: rzpOrder.id, uniqueId: receiptId, razorpayOrderPayload: JSON.stringify(rzpOrder), customerShippingId: shipping.shippingId, referrerId: promo.referrerIdNum, coin: wallet.coin });
    logger.info(`${name} success`, { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
    queueCRMLead(
      { params: { userId: customerId, packageId: planSql.packageId, planId: body.packageId, amount: chargeAmount }, leadType: CRM_LEAD_TYPE.PAYMENT_MODE },
      { traceId, customerId, orderId }
    );
    return res.status(201).json({
      success: true,
      data: omit({
        subscriptionId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: chargeAmount,
        package: { _id: String(pkgSql.id), name: pkgSql.name },
        plan: { _id: String(body.packageId), duration: planSql.duration, price: planSql.price },
        promo: promoEcho(promo, chargeAmount),
      }, PAYMENT_ORDER_ECHO_KEYS),
    });
  } catch (e: any) {
    return createOrderFailure(res, e, name, traceId, req.user?.id);
  }
};
