// Client payments: ebook create-order (promo, wallet, Razorpay).
import { Request, Response } from "express";
import { z } from "zod";
import { buildOrderCodeSnapshots } from "../../modules/order-code-snapshot/order-code-snapshot.service";
import { razorpayResponseFor, createRazorpayOrder, PAYMENT_ORDER_ECHO_KEYS } from "./razorpay";
import { omit } from "../../utils/pick";
import logger from "../../utils/logger";
import {
  createEbookOrderMysql,
  findEbookPlanForOrder,
} from "../../modules/ebook-order/ebook-order.service";
import { findActiveEbookById } from "../../modules/catalog-ebook/catalog-ebook.service";
import {
  planIdField, promocodeField, coinField, requirePaymentCustomer,
  applyOrderPromo, applyOrderWallet, receiptIdFor, promoEcho,
} from "./payment-order.shared";

// Ebooks are digital — no delivery address.
const createEbookOrderMysqlSchema = z.object({
  planId: planIdField("Please select a valid eBook plan."),
  promocode: promocodeField,
  coin: coinField,
});

// Creates a PENDING EbookOrder + Razorpay order; /verify (or the webhook) completes it
// and provisions the EbookSubscription. The client only round-trips the Razorpay order
// id; ebookOrderId is the order row id.
export const createEbookOrderPayment = async (req: Request, res: Response) => {
  const name = "createEbookOrderPayment";
  const traceId = req.traceId;
  logger.info(`${name} invoked`, { traceId, path: req.originalUrl, customerId: req.user?.id });

  try {
    const ctx = requirePaymentCustomer(req, res, name);
    if (!ctx) return;
    const { customerId, rp } = ctx;
    const { planId, promocode, coin } = createEbookOrderMysqlSchema.parse(req.body);

    const plan = await findEbookPlanForOrder(planId);
    if (!plan) {
      logger.warn(`${name} plan invalid/inactive`, { traceId, customerId, planId });
      return res.status(404).json({
        success: false,
        message: "This eBook plan is currently unavailable. Please choose another plan.",
      });
    }

    const ebook = await findActiveEbookById(plan.ebookId);
    if (!ebook) {
      logger.warn(`${name} ebook not found`, { traceId, customerId, ebookId: plan.ebookId });
      return res.status(404).json({ success: false, message: "Ebook not found or inactive." });
    }

    const promo = await applyOrderPromo(res, ctx, promocode, plan.price, { type: "ebook", id: plan.ebookId }, planId);
    if (!promo) return;

    // Freeze the redeemed code as the snapshot OBJECT. ws_ebook_order has only a
    // `promocode` column, so referrer_id tells promo and referral apart; promoter-data
    // reads ebook commission off this column by JSON path.
    const codeSnapshot = await buildOrderCodeSnapshots({
      promocodeId: promo.promocodeIdNum,
      referrerId: promo.referrerIdNum,
      planId,
    });
    const codeJson = codeSnapshot.promocode ?? codeSnapshot.refferalcode;

    const wallet = await applyOrderWallet(res, ctx, coin, plan.price, promo.chargeAmount);
    if (!wallet) return;
    const { chargeAmount } = wallet;

    const receiptId = receiptIdFor("ebook");
    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "ebook",
        ebookId: String(plan.ebookId),
        planId: String(planId),
        customerId: String(customerId),
        ...(promo.promocodeIdNum ? { promocodeId: String(promo.promocodeIdNum) } : {}),
      },
    });

    const { orderId } = await createEbookOrderMysql({
      customerId,
      planId,
      orderPrice: chargeAmount,
      razorpayOrderId: rzpOrder.id,
      uniqueId: receiptId,
      code: codeJson,
      referrerId: promo.referrerIdNum,
      coin: wallet.coin,
    });

    logger.info(`${name} success`, { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
    return res.status(201).json({
      success: true,
      data: omit({
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
        promo: promoEcho(promo, chargeAmount),
      }, PAYMENT_ORDER_ECHO_KEYS),
    });
  } catch (e: any) {
    // Response contract: course/ebook errors (validation included) have always gone to
    // errorHandler (which logs them) and its envelope, not createOrderFailure's.
    throw e;
  }
};
