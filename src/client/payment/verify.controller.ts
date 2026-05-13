import { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookCart } from "../../models/book/BookCart.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import {
  BookOrderStatus,
  PackageCourseEbookOrderStatus,
  PackageCourseEbookPaymentType,
} from "../../models/enums";

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

// Razorpay signs `${order_id}|${payment_id}` with HMAC-SHA256 keyed by the
// merchant's key_secret. We must compare hex-encoded; mismatched signatures
// mean the request is forged or replayed against a different order.
const verifySignature = (
  orderId: string,
  paymentId: string,
  signature: string
): boolean => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  // Constant-time compare so signature length doesn't leak via timing.
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

// POST /api/v1/client/payment/verify
// Called by the app after Razorpay's checkout succeeds. We HMAC-verify the
// signature, then dispatch fulfillment based on which local row holds this
// razorpay_order_id (BookOrder vs PackageCourseSubscription). Idempotent:
// re-running on an already-verified order returns 200 with the existing row.
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      verifySchema.parse(req.body);

    if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({
        success: false,
        message: "Signature verification failed.",
      });
    }

    // Find which local entity owns this Razorpay order. It's exactly one of
    // these — neither, multiple, or duplicates would be a bug worth surfacing.
    const [bookOrder, courseSub, ebookOrder, liveCourseSub] = await Promise.all([
      BookOrder.findOne({ razorpayOrderId: razorpay_order_id, customerId: userId }),
      PackageCourseSubscription.findOne({
        razorpayOrderId: razorpay_order_id,
        customerId: userId,
      }),
      EbookOrder.findOne({ razorpayOrderId: razorpay_order_id, customerId: userId }),
      LiveCourseSubscription.findOne({
        razorpayOrderId: razorpay_order_id,
        customerId: userId,
      }),
    ]);

    if (!bookOrder && !courseSub && !ebookOrder && !liveCourseSub) {
      return res.status(404).json({
        success: false,
        message: "No local order found for this Razorpay order id.",
      });
    }

    if (bookOrder) {
      // Idempotency: already verified means the webhook (or a previous call)
      // beat us to it. Return success without re-running side effects.
      if (bookOrder.status !== BookOrderStatus.PENDING) {
        return res.status(200).json({
          success: true,
          data: { kind: "book", order: bookOrder },
          message: "Already verified.",
        });
      }

      bookOrder.status = BookOrderStatus.VERIFIED;
      bookOrder.razorpayPaymentId = razorpay_payment_id;
      bookOrder.paidAt = new Date();
      await bookOrder.save();

      // Deactivate whichever cart pointed at this order's shipping. We match
      // on shippingId — the cart that was used to place this order. Other
      // active carts (rare, but possible if the user opened a new session) stay.
      await BookCart.updateOne(
        { customerId: userId, status: true, shippingId: bookOrder.shippingId },
        { $set: { status: false } }
      );

      return res.status(200).json({
        success: true,
        data: { kind: "book", order: bookOrder },
      });
    }

    // courseSub branch
    if (courseSub) {
      if (courseSub.paymentStatus !== "pending") {
        return res.status(200).json({
          success: true,
          data: { kind: "course", subscription: courseSub },
          message: "Already verified.",
        });
      }

      // Look up the plan to compute access window. `duration` is stored as
      // MONTHS (matches the admin UI: "1 Month / 3 Months / 6 Months / 12 Months").
      // We use setMonth so calendar-month length is honoured — a 6-month plan
      // bought on Mar 11 expires on Sep 11, not "now + 180 days".
      const plan = await PackageCourseEbookPrice.findById(courseSub.packageId)
        .select("duration")
        .lean();
      const durationMonths = plan?.duration ?? 0;

      const now = new Date();
      const endAt = new Date(now);
      endAt.setMonth(endAt.getMonth() + durationMonths);

      courseSub.paymentStatus = "verified";
      courseSub.razorpayPaymentId = razorpay_payment_id;
      courseSub.paidAt = now;
      courseSub.startAt = now;
      courseSub.endAt = endAt;
      await courseSub.save();

      return res.status(200).json({
        success: true,
        data: { kind: "course", subscription: courseSub },
      });
    }

    if (liveCourseSub) {
      if (liveCourseSub.paymentStatus !== "pending") {
        return res.status(200).json({
          success: true,
          data: { kind: "live-course", subscription: liveCourseSub },
          message: "Already verified.",
        });
      }

      const plan = await LiveCoursePlan.findById(liveCourseSub.planId).select("duration").lean();
      const durationMonths = plan?.duration ?? 0;

      const now = new Date();
      const endAt = new Date(now);
      endAt.setMonth(endAt.getMonth() + durationMonths);

      liveCourseSub.paymentStatus = "verified";
      liveCourseSub.razorpayPaymentId = razorpay_payment_id;
      liveCourseSub.paidAt = now;
      liveCourseSub.startAt = now;
      liveCourseSub.endAt = endAt;
      await liveCourseSub.save();

      return res.status(200).json({
        success: true,
        data: { kind: "live-course", subscription: liveCourseSub },
      });
    }

    if (ebookOrder) {
      if (ebookOrder.status !== PackageCourseEbookOrderStatus.PENDING) {
        return res.status(200).json({
          success: true,
          data: { kind: "ebook", order: ebookOrder },
          message: "Already verified.",
        });
      }

      // `duration` is stored as MONTHS — matches the webhook fulfillment path.
      const plan = await EbookPrice.findById(ebookOrder.planId).select("duration").lean();
      const durationMonths = plan?.duration ?? 0;

      ebookOrder.status = PackageCourseEbookOrderStatus.COMPLETE;
      ebookOrder.razorpayPaymentId = razorpay_payment_id;
      await ebookOrder.save();

      const startAt = new Date();
      const endAt = new Date(startAt);
      endAt.setMonth(endAt.getMonth() + durationMonths);
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

      return res.status(200).json({
        success: true,
        data: { kind: "ebook", order: ebookOrder },
      });
    }

    // Unreachable — TypeScript exhaustiveness only.
    return res.status(500).json({ success: false, message: "Unhandled order kind." });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    console.error("[payment/verify] failed:", e);
    return res.status(500).json({
      success: false,
      message: e?.message || "Verification failed.",
    });
  }
};
