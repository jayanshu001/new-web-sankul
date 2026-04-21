import { Request, Response } from "express";
import crypto from "crypto";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookPaymentType,
  BookOrderStatus,
} from "../../models/enums";

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
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    const rawBody = JSON.stringify(req.body);

    if (RAZORPAY_WEBHOOK_SECRET) {
      if (!signature || !verifySignature(rawBody, signature)) {
        return res.status(401).json({ success: false, message: "Invalid signature." });
      }
    }

    const event = req.body?.event as string;
    const payment = req.body?.payload?.payment?.entity;
    if (!event || !payment) {
      return res.status(400).json({ success: false, message: "Invalid webhook payload." });
    }

    if (event !== "payment.captured" && event !== "order.paid") {
      // Acknowledge but skip — not a success event
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
          const startAt = new Date();
          const endAt = new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);
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
      return res.status(200).json({ success: true, message: "Book order verified." });
    }

    // Course/package subscription — matched by razorpayOrderId stored on payload
    // Our PackageCourseSubscription doesn't carry razorpayOrderId; webhook relies on the client
    // calling /orders/verify-payment with the razorpay ids after checkout. We accept here but no-op.
    return res.status(200).json({ success: true, message: "No matching order — acknowledged." });
  } catch (e: any) {
    // Always return 200 to webhooks — razorpay treats non-2xx as retry. We log instead.
    console.error("[paymentWebhook]", e);
    return res.status(200).json({ success: false, message: e.message });
  }
};
