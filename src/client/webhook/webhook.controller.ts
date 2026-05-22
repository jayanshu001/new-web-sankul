import { Request, Response } from "express";
import crypto from "crypto";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookPaymentType,
  BookOrderStatus,
} from "../../models/enums";
import { computeEndAt } from "../../utils/planDuration";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

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

    // Try ebook order first
    const ebookOrder = await EbookOrder.findOne({ razorpayOrderId });
    if (ebookOrder) {
      if (ebookOrder.status !== PackageCourseEbookOrderStatus.COMPLETE) {
        ebookOrder.status = PackageCourseEbookOrderStatus.COMPLETE;
        ebookOrder.razorpayPaymentId = razorpayPaymentId;
        await ebookOrder.save();

        const plan = await EbookPrice.findById(ebookOrder.planId);
        if (plan) {
          // `duration` is stored as MONTHS — shared helper enforces the
          // setMonth-honors-calendar-length contract uniformly.
          const startAt = new Date();
          const endAt = computeEndAt({ startAt, durationMonths: plan.duration });
          await EbookSubscription.create({
            orderId: ebookOrder._id,
            customerId: ebookOrder.customerId,
            ebookId: ebookOrder.ebookId,
            price: ebookOrder.orderPrice,
            startAt,
            endAt,
            paymentType: PackageCourseEbookPaymentType.ONLINE,
            status: true,
          });
        }
      }
      logger.info("paymentWebhook ebook activated", { traceId, razorpayOrderId, orderId: ebookOrder._id });
      return res.status(200).json({ success: true, message: "Ebook order activated." });
    }

    // Try book order
    const bookOrder = await BookOrder.findOne({ razorpayOrderId });
    if (bookOrder) {
      if (bookOrder.status !== BookOrderStatus.VERIFIED) {
        bookOrder.status = BookOrderStatus.VERIFIED;
        bookOrder.razorpayPaymentId = razorpayPaymentId;
        bookOrder.paidAt = new Date();
        await bookOrder.save();
      }
      logger.info("paymentWebhook book verified", { traceId, razorpayOrderId, orderId: bookOrder._id });
      return res.status(200).json({ success: true, message: "Book order verified." });
    }

    // Live course subscription — unlike PackageCourseSubscription, this row
    // DOES carry razorpayOrderId, so the webhook can fulfill it directly as a
    // safety net for when the client never calls /payment/verify. Idempotent:
    // skips if already verified. Mirrors the verify.controller live branch.
    const liveCourseSub = await LiveCourseSubscription.findOne({ razorpayOrderId });
    if (liveCourseSub) {
      if (liveCourseSub.paymentStatus !== "verified") {
        // `duration` is stored as MONTHS — shared helper enforces the
        // setMonth-honors-calendar-length contract uniformly.
        const plan = await LiveCoursePlan.findById(liveCourseSub.planId)
          .select("duration")
          .lean();
        const durationMonths = plan?.duration ?? 0;

        const now = new Date();
        const endAt = computeEndAt({ startAt: now, durationMonths });

        liveCourseSub.paymentStatus = "verified";
        liveCourseSub.razorpayPaymentId = razorpayPaymentId;
        liveCourseSub.paidAt = now;
        liveCourseSub.startAt = now;
        liveCourseSub.endAt = endAt;
        await liveCourseSub.save();
      }
      logger.info("paymentWebhook live course activated", { traceId, razorpayOrderId, subscriptionId: liveCourseSub._id });
      return res
        .status(200)
        .json({ success: true, message: "Live course subscription activated." });
    }

    // Course/package subscription — matched by razorpayOrderId stored on payload
    // Our PackageCourseSubscription doesn't carry razorpayOrderId; webhook relies on the client
    // calling /orders/verify-payment with the razorpay ids after checkout. We accept here but no-op.
    logger.info("paymentWebhook no match", { traceId, razorpayOrderId });
    return res.status(200).json({ success: true, message: "No matching order — acknowledged." });
  } catch (e: any) {
    // Always return 200 to webhooks — razorpay treats non-2xx as retry. We log instead.
    logger.error("paymentWebhook failed", { traceId, error: getErrorMessage(e), stack: e?.stack });
    return res.status(200).json({ success: false, message: e.message });
  }
};
