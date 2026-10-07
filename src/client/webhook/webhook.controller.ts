// Client webhooks: Razorpay payment webhook fulfilment.
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
  if (!RAZORPAY_WEBHOOK_SECRET || signature.length !== 64) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Razorpay webhook. Expects X-Razorpay-Signature header.
export const paymentWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("paymentWebhook invoked", { traceId, path: req.originalUrl, event: req.body?.event });

  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    // Razorpay signs the raw bytes: verify against the buffer stashed by the body
    // parser (app.ts); re-serializing req.body changes whitespace/key order.
    const rawBodyBuf = (req as any).rawBody as Buffer | undefined;
    const rawBody = rawBodyBuf ? rawBodyBuf.toString("utf8") : JSON.stringify(req.body);

    // Fail closed: the route has no Bearer, so the signature is the only gate and a
    // missing secret must reject.
    if (!signature || !verifySignature(rawBody, signature)) {
      logger.warn("paymentWebhook signature mismatch", {
        traceId,
        event: req.body?.event,
        orderId: req.body?.payload?.payment?.entity?.order_id,
        hasRawBody: !!rawBodyBuf,
        secretSet: !!RAZORPAY_WEBHOOK_SECRET,
      });
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    const event = req.body?.event as string;
    const payment = req.body?.payload?.payment?.entity;
    if (!event || !payment) {
      logger.warn("paymentWebhook invalid payload", { traceId, event });
      return res.status(400).json({ success: false, message: "Invalid webhook payload." });
    }

    if (event !== "payment.captured" && event !== "order.paid") {
      logger.info("paymentWebhook ignored event", { traceId, event });
      return res.status(200).json({ success: true, message: "Ignored." });
    }

    const razorpayOrderId = payment.order_id as string;
    const razorpayPaymentId = payment.id as string;

    // Fulfillers are keyed by razorpayOrderId alone (the payload has no customer)
    // and are idempotent, same as /verify.
    const ebookFulfilled = await fulfillEbookWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (ebookFulfilled) {
      logger.info("paymentWebhook ebook activated (mysql)", { traceId, razorpayOrderId, orderId: ebookFulfilled._id });
      return res.status(200).json({ success: true, message: "Ebook subscription activated." });
    }

    const bookFulfilled = await fulfillBookWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (bookFulfilled) {
      logger.info("paymentWebhook book verified (mysql)", { traceId, razorpayOrderId, orderId: bookFulfilled._id });
      return res.status(200).json({ success: true, message: "Book order verified." });
    }

    const tsFulfilled = await tsOrderSql.fulfillWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (tsFulfilled) {
      logger.info("paymentWebhook test-series activated (mysql)", { traceId, razorpayOrderId, subscriptionId: tsFulfilled._id });
      return res.status(200).json({ success: true, message: "Test series subscription activated." });
    }

    const liveFulfilled = await fulfillLiveCourseWebhookMysql(razorpayOrderId, razorpayPaymentId);
    if (liveFulfilled) {
      logger.info("paymentWebhook live course activated (mysql)", { traceId, razorpayOrderId, subscriptionId: liveFulfilled._id });
      return res.status(200).json({ success: true, message: "Live course subscription activated." });
    }

    // Course/package rows don't carry razorpayOrderId; those are fulfilled only by
    // the client's verify call, so this is an accepted no-op.
    logger.info("paymentWebhook no match", { traceId, razorpayOrderId });
    return res.status(200).json({ success: true, message: "No matching order — acknowledged." });
  } catch (e: any) {
    // Always 200: Razorpay retries on non-2xx.
    logger.error("paymentWebhook failed", { traceId, error: getErrorMessage(e), stack: e?.stack });
    return res.status(200).json({ success: false, message: e.message });
  }
};
