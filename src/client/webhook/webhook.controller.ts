import { Request, Response } from "express";
import crypto from "crypto";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { fulfillLiveCourseWebhookMysql } from "../../modules/live-course-order/live-course-order.service";
import { fulfillEbookWebhookMysql } from "../../modules/ebook-order/ebook-order.service";
import { fulfillBookWebhookMysql } from "../../modules/book-order/book-order.service";
import * as tsOrderSql from "../../modules/test-series-order/test-series-order.service";

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

function verifySignature(rawBody: string, signature: string): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// POST /api/v1/client/webhook/payment
// Razorpay webhook. Expects X-Razorpay-Signature header.
export const paymentWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("paymentWebhook invoked", { traceId, path: req.originalUrl, event: req.body?.event });

  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    const rawBody = JSON.stringify(req.body);

    if (RAZORPAY_WEBHOOK_SECRET) {
      if (!signature || !verifySignature(rawBody, signature)) {
        logger.warn("paymentWebhook signature mismatch", { traceId });
        return res.status(401).json({ success: false, message: "Invalid signature." });
      }
    }

    const event = req.body?.event as string;
    const payment = req.body?.payload?.payment?.entity;
    if (!event || !payment) {
      logger.warn("paymentWebhook invalid payload", { traceId, event });
      return res.status(400).json({ success: false, message: "Invalid webhook payload." });
    }

    if (event !== "payment.captured" && event !== "order.paid") {
      // Acknowledge but skip — not a success event
      logger.info("paymentWebhook ignored event", { traceId, event });
      return res.status(200).json({ success: true, message: "Ignored." });
    }

    const razorpayOrderId = payment.order_id as string;
    const razorpayPaymentId = payment.id as string;

    // ── Ebook webhook fulfillment (ebook-order) ──────────────────────────────
    // Keyed by razorpayOrderId alone (no customer in the webhook payload). Same
    // idempotent fold-or-fresh as /verify.
    const ebookFulfilled = await fulfillEbookWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (ebookFulfilled) {
      logger.info("paymentWebhook ebook activated (mysql)", { traceId, razorpayOrderId, orderId: ebookFulfilled._id });
      return res.status(200).json({ success: true, message: "Ebook subscription activated." });
    }

    // ── Book webhook fulfillment (book-order) ────────────────────────────────
    // AWB allocated SQL-side in verifyBookOrderMysql's txn.
    const bookFulfilled = await fulfillBookWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (bookFulfilled) {
      logger.info("paymentWebhook book verified (mysql)", { traceId, razorpayOrderId, orderId: bookFulfilled._id });
      return res.status(200).json({ success: true, message: "Book order verified." });
    }

    // ── Test-series webhook fulfillment (test-series-order) ───────────────────
    const tsFulfilled = await tsOrderSql.fulfillWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (tsFulfilled) {
      logger.info("paymentWebhook test-series activated (mysql)", { traceId, razorpayOrderId, subscriptionId: tsFulfilled._id });
      return res.status(200).json({ success: true, message: "Test series subscription activated." });
    }

    // ── Live-course webhook fulfillment (live-course-order) ───────────────────
    // Single-table SQL sub carries razorpayOrderId; fulfill (fold-or-fresh,
    // idempotent) keyed by order id.
    const liveFulfilled = await fulfillLiveCourseWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (liveFulfilled) {
      logger.info("paymentWebhook live course activated (mysql)", { traceId, razorpayOrderId, subscriptionId: liveFulfilled._id });
      return res.status(200).json({ success: true, message: "Live course subscription activated." });
    }

    // Course/package subscription — matched by razorpayOrderId stored on payload.
    // The course/package subscription row doesn't carry razorpayOrderId; the webhook
    // relies on the client calling /orders/verify-payment with the razorpay ids after
    // checkout. We accept here but no-op.
    logger.info("paymentWebhook no match", { traceId, razorpayOrderId });
    return res.status(200).json({ success: true, message: "No matching order — acknowledged." });
  } catch (e: any) {
    // Always return 200 to webhooks — razorpay treats non-2xx as retry. We log instead.
    logger.error("paymentWebhook failed", { traceId, error: getErrorMessage(e), stack: e?.stack });
    return res.status(200).json({ success: false, message: e.message });
  }
};
