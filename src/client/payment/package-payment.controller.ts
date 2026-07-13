import { Request, Response } from "express";
import { z } from "zod";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { prisma } from "../../config/prisma";
import {
  findPackagePlanForOrder,
  createPackageOrderMysql,
} from "../../modules/commerce-order/commerce-order.service";
import { resolvePromoForPlanSql, addressBelongsToCustomerSql } from "../../modules/promo-code/promo-code.service";
import { resolveWalletUsage } from "../../modules/referral/referral.service";

// SQL planId is numeric (migrated id-space).
const createPackageOrderSqlSchema = z.object({
  packageId: z.coerce.number().int().positive(),
  customerShippingId: z.coerce.number().int().positive().optional(),
  promocode: z.string().trim().min(1).optional(),
  coin: z.coerce.number().int().min(0).optional(),
});

// POST /api/v1/client/payment/create-order/package
// Mirror of /create-order/course but for plan rows whose `packageId` (target
// Package) is set instead of `courseId`. Creates a PackageCourseSubscription
// in paymentStatus="pending" and a Razorpay order. /verify flips it to verified.
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

    // ── MySQL package write path (commerce-order tables) ─────────────────────
    // 3-table pattern (order → sub+tracking at verify), mirroring the course path.
    // Writes only the pending ws_package_course_order row here; /payment/verify
    // creates/extends the subscription.
    {
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) {
        logger.warn("createPackageOrderPayment[mysql] non-int customer id", { traceId, customerId });
        return res.status(400).json({ success: false, message: "Invalid customer id." });
      }
      const body = createPackageOrderSqlSchema.parse(req.body);
      if (body.customerShippingId) {
        const ok = await addressBelongsToCustomerSql(body.customerShippingId, customerIdInt);
        if (!ok) return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
      }
      const planSql = await findPackagePlanForOrder(body.packageId);
      if (!planSql) {
        logger.warn("createPackageOrderPayment[mysql] plan invalid/not-package/zero", { traceId, customerId, packageId: body.packageId });
        return res.status(404).json({ success: false, message: "Plan not found, not a package plan, or zero price." });
      }
      const pkgSql = await prisma.package.findFirst({ where: { id: planSql.packageId }, select: { id: true, name: true } });

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

      // Wallet ("coin") redemption — validate + reduce the charged amount (debited at verify).
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
      // NOTE: SQL order row carries the CHARGED amount (post-promo) as both price
      // and discount_price (commerce-order.createPendingOrder sets both = input).
      const { orderId } = await createPackageOrderMysql({ customerId: customerIdInt, planId: body.packageId, price: chargeAmount, razorpayOrderId: rzpOrder.id, customerShippingId: body.customerShippingId ?? null, referrerId: referrerIdNum, coin: walletUsage.coin });
      logger.info("createPackageOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
      return res.status(201).json({
        success: true,
        data: {
          subscriptionId: String(orderId), receiptId, razorpay: razorpayResponseFor(rzpOrder), amountInRupees: chargeAmount,
          package: pkgSql ? { _id: String(pkgSql.id), name: pkgSql.name } : { _id: String(planSql.packageId), name: null },
          plan: { _id: String(body.packageId), duration: planSql.duration, price: planSql.price },
          promo: promocodeIdNum ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount } : null,
        },
      });
    }
  } catch (e: any) {
    if (e.issues) { logger.warn("createPackageOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating package payment order.";
    logger.error("createPackageOrderPayment failed", { traceId, customerId, error: message, stack: e?.stack });
    return res.status(500).json({ success: false, message });
  }
};
