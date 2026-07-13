import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql } from "../../modules/promo-code/promo-code.service";
import { resolveWalletUsage } from "../../modules/referral/referral.service";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import {
  createEbookOrderMysql,
  findEbookPlanForOrder,
} from "../../modules/ebook-order/ebook-order.service";
import { findActiveEbookById } from "../../modules/catalog-ebook/catalog-ebook.service";

/** Non-null Razorpay client (the controller has already null-checked it). */
type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;

// MySQL ebook write path: the plan id is an INT (the migrated id-space). Accepts
// the same optional promo code as the Mongo branch (ebooks are digital — no
// delivery address).
const createEbookOrderMysqlSchema = z.object({
  planId: z.coerce.number().int().positive(),
  promocode: z.string().trim().min(1).optional(),
  coin: z.coerce.number().int().min(0).optional(),
});

// POST /api/v1/client/payment/create-order/ebook
// Creates an EbookOrder in PENDING status and a Razorpay order. /verify (or the
// webhook) flips status to COMPLETE and provisions the EbookSubscription.
export const createEbookOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createEbookOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createEbookOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createEbookOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    // C3 seam: coerce the string-typed token subject to the int customer id.
    const customerIdInt = Number(customerId);
    if (!Number.isInteger(customerIdInt)) {
      logger.warn("createEbookOrderPayment[mysql] non-int customer id", { traceId, customerId });
      return res.status(400).json({ success: false, message: "Invalid customer id." });
    }
    return createEbookOrderMysqlPath(req, res, { traceId, customerId: customerIdInt, rp });
  } catch (e: any) {
    if (e.issues) { logger.warn("createEbookOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating ebook payment order.";
    logger.error("createEbookOrderPayment failed", { traceId, customerId, error: message, stack: e?.stack });
    return res.status(500).json({ success: false, message });
  }
};

// MySQL ebook create-order. Reads plan + ebook from MySQL, writes the pending
// ws_ebook_order row, creates the Razorpay order, returns the SAME response shape
// as the Mongo branch (ebookOrderId = the MySQL order id). /verify (ebook branch)
// completes it. Contract-safe: the client only round-trips the razorpay order id.
const createEbookOrderMysqlPath = async (
  req: Request,
  res: Response,
  ctx: { traceId?: string; customerId: number; rp: RazorpayClient }
) => {
  const { traceId, customerId, rp } = ctx;
  const { planId, promocode, coin } = createEbookOrderMysqlSchema.parse(req.body);

  const plan = await findEbookPlanForOrder(planId);
  if (!plan) {
    logger.warn("createEbookOrderPayment[mysql] plan invalid", { traceId, customerId, planId });
    return res.status(404).json({
      success: false,
      message: "Plan not found, not an ebook plan, or zero price.",
    });
  }

  const ebook = await findActiveEbookById(plan.ebookId);
  if (!ebook) {
    logger.warn("createEbookOrderPayment[mysql] ebook not found", { traceId, customerId, ebookId: plan.ebookId });
    return res.status(404).json({ success: false, message: "Ebook not found or inactive." });
  }

  // Resolve the promo code (if any) against THIS ebook; charge the reduced
  // amount. Re-validated here — the /promocodes/apply preview is never trusted.
  let chargeAmount = plan.price;
  let promocodeIdNum: number | null = null;
  let originalAmount: number | null = null;
  let discountAmount: number | null = null;
  let referrerIdNum: number | null = null;
  if (promocode) {
    const { result, error } = await resolvePromoForPlanSql(promocode, plan.price, { type: "ebook", id: plan.ebookId }, planId, Number(customerId));
    if (error || !result) {
      logger.warn("createEbookOrderPayment[mysql] promo rejected", { traceId, customerId, promocode, error });
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }
    if (result.finalAmount < 1) return res.status(400).json({ success: false, message: "This promo code reduces the price below the minimum payable amount. Please contact support." });
    chargeAmount = result.finalAmount;
    const pid = Number(result.promo._id);
    promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
    originalAmount = result.originalAmount;
    discountAmount = result.discountAmount;
    referrerIdNum = result.referrerId ?? null;
  }

  // Wallet ("coin") redemption — validate + reduce the charged amount (debited at verify).
  const walletUsage = await resolveWalletUsage(Number(customerId), coin, plan.price);
  if (walletUsage.error) {
    logger.warn("createEbookOrderPayment[mysql] wallet rejected", { traceId, customerId, coin, error: walletUsage.error });
    return res.status(400).json({ success: false, message: walletUsage.error });
  }
  if (walletUsage.coin > 0) {
    chargeAmount = chargeAmount - walletUsage.coin;
    if (chargeAmount < 1) return res.status(400).json({ success: false, message: "Amount after discount and wallet is below the minimum payable. Please reduce wallet usage." });
  }

  const receiptId = `ebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rzpOrder = await createRazorpayOrder(rp, {
    amount: Math.round(chargeAmount * 100), // paise
    currency: "INR",
    receipt: receiptId,
    notes: {
      kind: "ebook",
      ebookId: String(plan.ebookId),
      planId: String(planId),
      customerId: String(customerId),
      ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}),
    },
  });

  const { orderId } = await createEbookOrderMysql({
    customerId,
    planId,
    orderPrice: chargeAmount,
    razorpayOrderId: rzpOrder.id,
    uniqueId: receiptId,
    referrerId: referrerIdNum,
    coin: walletUsage.coin,
  });

  logger.info("createEbookOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
  return res.status(201).json({
    success: true,
    data: {
      ebookOrderId: String(orderId),
      receiptId,
      razorpay: razorpayResponseFor(rzpOrder),
      amountInRupees: chargeAmount,
      ebook: {
        _id: ebook._id,
        name: ebook.name,
      },
      plan: {
        _id: String(planId),
        duration: plan.duration,
        price: plan.price,
      },
      promo: promocodeIdNum
        ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount }
        : null,
    },
  });
};
