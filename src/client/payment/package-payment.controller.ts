// Client payments: package create-order (promo, wallet, shipping snapshot, Razorpay).
import { Request, Response } from "express";
import { z, ZodError } from "zod";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import logger from "../../utils/logger";
import { formatZodError } from "../../utils/httpResponse";
import { prisma } from "../../config/prisma";
import {
  findPackagePlanForOrder,
  createPackageOrderMysql,
} from "../../modules/commerce-order/commerce-order.service";
import { resolvePromoForPlanSql } from "../../modules/promo-code/promo-code.service";
import { resolveShippingIdForAddress } from "../../modules/customer-shipping/customer-shipping.service";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { resolveWalletUsage } from "../../modules/referral/referral.service";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

const createPackageOrderSqlSchema = z.object({
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

// Like /create-order/course but for plan rows with `packageId` set. Writes only the
// pending ws_package_course_order row + Razorpay order; /payment/verify creates the subscription.
export const createPackageOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createPackageOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createPackageOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createPackageOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    {
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) {
        logger.warn("createPackageOrderPayment[mysql] non-int customer id", { traceId, customerId });
        return res.status(400).json({ success: false, message: "Invalid customer id." });
      }
      const body = createPackageOrderSqlSchema.parse(req.body);
      // The request carries an address-book id (ws_customer_address), but
      // `ws_package_course_order.shipping` is an FK to ws_customer_shipping, so the
      // address is snapshotted into a shipping row. Resolving also proves ownership.
      let shippingIdSql: number | null = null;
      if (body.customerShippingId) {
        const resolved = await resolveShippingIdForAddress(customerIdInt, body.customerShippingId);
        if (!resolved.ok) {
          logger.warn("createPackageOrderPayment[mysql] shipping resolve failed", { traceId, customerId, customerShippingId: body.customerShippingId, reason: resolved.reason });
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
      const planSql = await findPackagePlanForOrder(body.packageId);
      if (!planSql) {
        logger.warn("createPackageOrderPayment[mysql] plan invalid/not-package/zero/inactive", { traceId, customerId, packageId: body.packageId });
        return res.status(404).json({ success: false, message: "This plan is currently unavailable. Please choose another plan." });
      }
      // A disabled package must not be purchasable even if a stale plan row points at it.
      const pkgSql = await prisma.package.findFirst({ where: { id: planSql.packageId, active: true }, select: { id: true, name: true } });
      if (!pkgSql) {
        logger.warn("createPackageOrderPayment[mysql] package inactive/missing", { traceId, customerId, targetPackageId: planSql.packageId });
        return res.status(404).json({ success: false, message: "This package is currently unavailable. Please choose another." });
      }

      let chargeAmount = planSql.price;
      let promocodeIdNum: number | null = null;
      let referrerIdNum: number | null = null;
      let originalAmount: number | null = null;
      let discountAmount: number | null = null;
      if (body.promocode) {
        const { result, error } = await resolvePromoForPlanSql(body.promocode, planSql.price, { type: "package", id: planSql.packageId }, body.packageId, Number(customerId));
        if (error || !result) return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
        if (result.finalAmount < 1) return res.status(400).json({ success: false, message: "This promo code reduces the price below the minimum payable amount. Please contact support." });
        chargeAmount = result.finalAmount;
        const pid = Number(String(result.promo._id));
        promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
        originalAmount = result.originalAmount;
        discountAmount = result.discountAmount;
        referrerIdNum = result.referrerId ?? null;
      }

      // Freeze the redeemed code as the snapshot OBJECT in exactly one column
      // (promocode vs refferalcode); promoter-data attributes commission by JSON path over it.
      const codeSnapshot = await buildOrderCodeSnapshots({
        promocodeId: promocodeIdNum,
        referrerId: referrerIdNum,
        planId: body.packageId,
      });

      // Wallet ("coin") redemption reduces the charge here; the debit happens at verify.
      const walletUsage = await resolveWalletUsage(customerIdInt, body.coin, planSql.price);
      if (walletUsage.error) {
        logger.warn("createPackageOrderPayment[mysql] wallet rejected", { traceId, customerId, coin: body.coin, error: walletUsage.error });
        return res.status(400).json({ success: false, message: walletUsage.error });
      }
      if (walletUsage.coin > 0) {
        chargeAmount = chargeAmount - walletUsage.coin;
        if (chargeAmount < 1) return res.status(400).json({ success: false, message: "Amount after discount and wallet is below the minimum payable. Please reduce wallet usage." });
      }

      const receiptId = `package-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rzpOrder = await createRazorpayOrder(rp, {
        amount: Math.round(chargeAmount * 100), currency: "INR", receipt: receiptId,
        notes: { kind: "package", targetPackageId: String(planSql.packageId), packageId: String(body.packageId), customerId: String(customerIdInt), ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}) },
      });
      // Order row keeps the full breakdown:
      //   price (list) − code_discount (promo/referral) − ws_coin = discount_price (paid)
      const { orderId } = await createPackageOrderMysql({ customerId: customerIdInt, planId: body.packageId, price: chargeAmount, originalPrice: planSql.price, codeDiscount: discountAmount ?? 0, promoCode: codeSnapshot.promocode, referralCode: codeSnapshot.refferalcode, razorpayOrderId: rzpOrder.id, uniqueId: receiptId, razorpayOrderPayload: JSON.stringify(rzpOrder), customerShippingId: shippingIdSql, referrerId: referrerIdNum, coin: walletUsage.coin });
      logger.info("createPackageOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
      queueCRMLead(
        { params: { userId: customerIdInt, packageId: planSql.packageId, planId: body.packageId, amount: chargeAmount }, leadType: CRM_LEAD_TYPE.PAYMENT_MODE },
        { traceId, customerId, orderId }
      );
      return res.status(201).json({
        success: true,
        data: omit({
          subscriptionId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: chargeAmount,
          package: { _id: String(pkgSql.id), name: pkgSql.name },
          plan: { _id: String(body.packageId), duration: planSql.duration, price: planSql.price },
          promo: promocodeIdNum ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount } : null,
        }, PAYMENT_ORDER_ECHO_KEYS),
      });
    }
  } catch (e: any) {
    if (e instanceof ZodError) {
      logger.warn("createPackageOrderPayment validation failed", { traceId, customerId, issues: e.issues });
      const { message, errors } = formatZodError(e);
      return res.status(400).json({ success: false, message, errors });
    }
    logger.error("createPackageOrderPayment failed", { traceId, customerId, error: e?.error?.description || e?.message, stack: e?.stack });
    return res.status(500).json({ success: false, message: e?.error?.description || "Something went wrong while creating your order. Please try again." });
  }
};
