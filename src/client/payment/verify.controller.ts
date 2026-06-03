import { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookCart } from "../../models/book/BookCart.model";
import { nextTrackingId } from "../../models/book/Counter.model";
import { COURIER } from "../../config/courier";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { TestSeriesOrder } from "../../models/testSeries/TestSeriesOrder.model";
import { TestSeriesPrice } from "../../models/testSeries/TestSeriesPrice.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import {
  BookOrderStatus,
  PackageCourseEbookOrderStatus,
  PackageCourseEbookPaymentType,
} from "../../models/enums";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

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
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("verifyPayment invoked", { traceId, path: req.originalUrl, customerId: userId, razorpayOrderId: req.body?.razorpay_order_id });

  try {
    if (!userId) { logger.warn("verifyPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      verifySchema.parse(req.body);

    if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      logger.warn("verifyPayment signature mismatch", { traceId, customerId: userId, razorpayOrderId: razorpay_order_id });
      return res.status(400).json({
        success: false,
        message: "Signature verification failed.",
      });
    }

    // Find which local entity owns this Razorpay order. It's exactly one of
    // these — neither, multiple, or duplicates would be a bug worth surfacing.
    const [bookOrder, courseSub, ebookOrder, liveCourseSub, testSeriesOrder] = await Promise.all([
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
      TestSeriesOrder.findOne({ razorpayOrderId: razorpay_order_id, customerId: userId }),
    ]);

    if (!bookOrder && !courseSub && !ebookOrder && !liveCourseSub && !testSeriesOrder) {
      logger.warn("verifyPayment no local order", { traceId, customerId: userId, razorpayOrderId: razorpay_order_id });
      return res.status(404).json({
        success: false,
        message: "No local order found for this Razorpay order id.",
      });
    }

    if (bookOrder) {
      // Idempotency: already verified means the webhook (or a previous call)
      // beat us to it. Return success without re-running side effects.
      if (bookOrder.status !== BookOrderStatus.PENDING) {
        logger.info("verifyPayment: book order already verified (idempotent)", {
          orderId: String(bookOrder._id),
          razorpay_order_id,
        });
        return res.status(200).json({
          success: true,
          data: { kind: "book", order: bookOrder },
          message: "Already verified.",
        });
      }

      bookOrder.status = BookOrderStatus.VERIFIED;
      bookOrder.razorpayPaymentId = razorpay_payment_id;
      bookOrder.paidAt = new Date();
      // Allocate the sequential courier tracking id (Point 1 & 2 of
      // book-order-courier-tracking.md): on verification the DB hands out the
      // next integer, which doubles as the courier AWB / docno. Stored as a
      // string to fit the schema; buildTrackingUrl() coerces it back to a
      // number for threshold routing. Only allocate once (idempotency above
      // guards re-entry, but guard here too in case of partial prior writes).
      if (!bookOrder.tracking.trackingId) {
        const allocated = await nextTrackingId(COURIER.TIRUPATI.INITIAL_Number);
        bookOrder.tracking.trackingId = String(allocated);
      }
      bookOrder.tracking.status = "Order Placed";
      bookOrder.tracking.history.push({
        status: "Order Placed",
        note: "Payment received",
        at: bookOrder.paidAt,
      } as any);
      await bookOrder.save();

      // Deactivate whichever cart pointed at this order's shipping. We match
      // on shippingId — the cart that was used to place this order. Other
      // active carts (rare, but possible if the user opened a new session) stay.
      const cartResult = await BookCart.updateOne(
        { customerId: userId, status: true, shippingId: bookOrder.shippingId },
        { $set: { status: false } }
      );
      logger.info("verifyPayment: book order verified", {
        orderId: String(bookOrder._id),
        razorpay_order_id,
        razorpay_payment_id,
        cartsDeactivated: cartResult.modifiedCount,
      });

      return res.status(200).json({
        success: true,
        data: { kind: "book", order: bookOrder },
      });
    }

    // courseSub branch
    if (courseSub) {
      if (courseSub.paymentStatus !== "pending") {
        logger.info("verifyPayment: course subscription already verified (idempotent)", {
          subscriptionId: String(courseSub._id),
          razorpay_order_id,
        });
        return res.status(200).json({
          success: true,
          data: { kind: "course", subscription: courseSub },
          message: "Already verified.",
        });
      }

      // Look up the plan to compute access window. `duration` is stored as
      // DAYS (matches the webhook fulfillment path and the ebook/test-series
      // branches). The shared helper applies setDate via `asDays:true` so a
      // 89-day plan bought today expires in 89 days, not 89 months — this
      // keeps verify / webhook / admin grant producing identical endAt values.
      const plan = await PackageCourseEbookPrice.findById(courseSub.packageId)
        .select("duration")
        .lean();
      const durationDays = plan?.duration ?? 0;
      if (!plan) {
        logger.warn("verifyPayment: course plan lookup returned null", {
          subscriptionId: String(courseSub._id),
          planId: String(courseSub.packageId),
        });
      }

      const now = new Date();

      // Upsert-extend: this pending row was created at order time. If the
      // customer ALREADY has an active verified subscription for the same
      // course/package target, fold the purchased window onto it and retire
      // this row — otherwise we'd surface two "My Subscription" cards for the
      // one course with different availability dates.
      const targetFilter: Record<string, any> = {
        _id: { $ne: courseSub._id },
        customerId: courseSub.customerId,
        status: true,
        paymentStatus: "verified",
      };
      if (courseSub.courseId) targetFilter.courseId = courseSub.courseId;
      else if (courseSub.targetPackageId) {
        targetFilter.courseId = null;
        targetFilter.targetPackageId = courseSub.targetPackageId;
      }
      const existingActive =
        courseSub.courseId || courseSub.targetPackageId
          ? await PackageCourseSubscription.findOne(targetFilter).sort({ endAt: -1 })
          : null;

      if (existingActive) {
        existingActive.endAt = extendEndAt({ currentEndAt: existingActive.endAt, durationMonths: durationDays, asDays: true, now });
        existingActive.paidAmount = (existingActive.paidAmount || 0) + (courseSub.paidAmount || 0);
        await existingActive.save();

        // Retire the just-paid pending row: record the payment + a pointer to
        // the row it extended, but keep status:false so it never lists.
        courseSub.paymentStatus = "verified";
        courseSub.razorpayPaymentId = razorpay_payment_id;
        courseSub.paidAt = now;
        courseSub.status = false;
        await courseSub.save();

        logger.info("verifyPayment: course subscription extended existing", {
          subscriptionId: String(existingActive._id),
          supersededId: String(courseSub._id),
          customerId: String(courseSub.customerId),
          razorpay_order_id,
          razorpay_payment_id,
          endAt: existingActive.endAt?.toISOString?.(),
        });

        return res.status(200).json({
          success: true,
          data: { kind: "course", subscription: existingActive },
        });
      }

      const endAt = computeEndAt({ startAt: now, durationMonths: durationDays, asDays: true });

      courseSub.paymentStatus = "verified";
      courseSub.razorpayPaymentId = razorpay_payment_id;
      courseSub.paidAt = now;
      courseSub.startAt = now;
      courseSub.endAt = endAt;
      await courseSub.save();

      logger.info("verifyPayment: course subscription activated", {
        subscriptionId: String(courseSub._id),
        planId: String(courseSub.packageId),
        customerId: String(courseSub.customerId),
        razorpay_order_id,
        razorpay_payment_id,
        durationDays,
        endAt: endAt.toISOString(),
      });

      return res.status(200).json({
        success: true,
        data: { kind: "course", subscription: courseSub },
      });
    }

    if (liveCourseSub) {
      if (liveCourseSub.paymentStatus !== "pending") {
        logger.info("verifyPayment: live-course subscription already verified (idempotent)", {
          subscriptionId: String(liveCourseSub._id),
          razorpay_order_id,
        });
        return res.status(200).json({
          success: true,
          data: { kind: "live-course", subscription: liveCourseSub },
          message: "Already verified.",
        });
      }

      const plan = await LiveCoursePlan.findById(liveCourseSub.planId).select("duration").lean();
      const durationMonths = plan?.duration ?? 0;
      if (!plan) {
        logger.warn("verifyPayment: live-course plan lookup returned null", {
          subscriptionId: String(liveCourseSub._id),
          planId: String(liveCourseSub.planId),
        });
      }

      const now = new Date();

      // Upsert-extend (same rationale as the course branch): fold onto an
      // existing active subscription for this live course rather than listing a
      // second card.
      const existingActive = await LiveCourseSubscription.findOne({
        _id: { $ne: liveCourseSub._id },
        customerId: liveCourseSub.customerId,
        liveCourseId: liveCourseSub.liveCourseId,
        status: true,
        paymentStatus: "verified",
        $or: [{ endAt: null }, { endAt: { $gte: now } }],
      }).sort({ endAt: -1 });

      if (existingActive) {
        existingActive.endAt = extendEndAt({ currentEndAt: existingActive.endAt, durationMonths, now });
        existingActive.paidAmount = (existingActive.paidAmount || 0) + (liveCourseSub.paidAmount || 0);
        await existingActive.save();

        liveCourseSub.paymentStatus = "verified";
        liveCourseSub.razorpayPaymentId = razorpay_payment_id;
        liveCourseSub.paidAt = now;
        liveCourseSub.status = false;
        await liveCourseSub.save();

        logger.info("verifyPayment: live-course subscription extended existing", {
          subscriptionId: String(existingActive._id),
          supersededId: String(liveCourseSub._id),
          customerId: String(liveCourseSub.customerId),
          liveCourseId: String(liveCourseSub.liveCourseId),
          razorpay_order_id,
          razorpay_payment_id,
          endAt: existingActive.endAt?.toISOString?.(),
        });

        return res.status(200).json({
          success: true,
          data: { kind: "live-course", subscription: existingActive },
        });
      }

      const endAt = computeEndAt({ startAt: now, durationMonths });

      liveCourseSub.paymentStatus = "verified";
      liveCourseSub.razorpayPaymentId = razorpay_payment_id;
      liveCourseSub.paidAt = now;
      liveCourseSub.startAt = now;
      liveCourseSub.endAt = endAt;
      await liveCourseSub.save();

      logger.info("verifyPayment: live-course subscription activated", {
        subscriptionId: String(liveCourseSub._id),
        planId: String(liveCourseSub.planId),
        customerId: String(liveCourseSub.customerId),
        liveCourseId: String(liveCourseSub.liveCourseId),
        razorpay_order_id,
        razorpay_payment_id,
        durationMonths,
        endAt: endAt.toISOString(),
      });

      return res.status(200).json({
        success: true,
        data: { kind: "live-course", subscription: liveCourseSub },
      });
    }

    if (ebookOrder) {
      if (ebookOrder.status !== PackageCourseEbookOrderStatus.PENDING) {
        logger.info("verifyPayment: ebook order already verified (idempotent)", {
          orderId: String(ebookOrder._id),
          razorpay_order_id,
        });
        return res.status(200).json({
          success: true,
          data: { kind: "ebook", order: ebookOrder },
          message: "Already verified.",
        });
      }

      // `duration` is stored as DAYS — matches the webhook fulfillment path.
      const plan = await EbookPrice.findById(ebookOrder.planId).select("duration").lean();
      const durationDays = plan?.duration ?? 0;
      if (!plan) {
        logger.warn("verifyPayment: ebook plan lookup returned null", {
          orderId: String(ebookOrder._id),
          planId: String(ebookOrder.planId),
        });
      }

      ebookOrder.status = PackageCourseEbookOrderStatus.COMPLETE;
      ebookOrder.razorpayPaymentId = razorpay_payment_id;
      await ebookOrder.save();

      const startAt = new Date();

      // Extend-on-active: if the customer already has an active subscription to
      // this ebook, stack the purchased days onto its endAt instead of creating
      // a second row — otherwise /client/ebooks would list two overlapping
      // entitlements with conflicting daysLeft. Mirrors the course/package
      // upsert-extend behavior; `asDays:true` because ebook `duration` is DAYS.
      const existingActive = await EbookSubscription.findOne({
        customerId: ebookOrder.customerId,
        ebookId: ebookOrder.ebookId,
        status: true,
        endAt: { $gt: startAt },
      }).sort({ endAt: -1 });

      if (existingActive) {
        existingActive.endAt = extendEndAt({
          currentEndAt: existingActive.endAt,
          durationMonths: durationDays,
          asDays: true,
          now: startAt,
        });
        existingActive.price = (existingActive.price || 0) + (ebookOrder.orderPrice || 0);
        // Point the row at the most recent paid order so the invoice/receipt
        // chain follows the latest payment.
        existingActive.orderId = ebookOrder._id;
        await existingActive.save();

        logger.info("verifyPayment: ebook subscription extended existing", {
          orderId: String(ebookOrder._id),
          subscriptionId: String(existingActive._id),
          ebookId: String(ebookOrder.ebookId),
          customerId: String(ebookOrder.customerId),
          razorpay_order_id,
          razorpay_payment_id,
          durationDays,
          endAt: existingActive.endAt?.toISOString?.(),
        });

        return res.status(200).json({
          success: true,
          data: { kind: "ebook", order: ebookOrder },
        });
      }

      const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
      // Order is COMPLETE on disk; if subscription.create fails next, we'd
      // be left with a paid order and no entitlement row. The thrown error
      // surfaces to the global handler, which logs it — but we add a trace
      // BEFORE the subscription write so the log file shows both sides.
      const subscription = await EbookSubscription.create({
        orderId: ebookOrder._id,
        customerId: ebookOrder.customerId,
        ebookId: ebookOrder.ebookId,
        price: ebookOrder.orderPrice,
        startAt,
        endAt,
        paymentType: PackageCourseEbookPaymentType.ONLINE,
        status: true,
      });

      logger.info("verifyPayment: ebook order activated", {
        orderId: String(ebookOrder._id),
        subscriptionId: String(subscription._id),
        ebookId: String(ebookOrder.ebookId),
        customerId: String(ebookOrder.customerId),
        razorpay_order_id,
        razorpay_payment_id,
        durationDays,
        endAt: endAt.toISOString(),
      });

      return res.status(200).json({
        success: true,
        data: { kind: "ebook", order: ebookOrder },
      });
    }

    if (testSeriesOrder) {
      if (testSeriesOrder.status !== PackageCourseEbookOrderStatus.PENDING) {
        logger.info("verifyPayment: test-series order already verified (idempotent)", {
          orderId: String(testSeriesOrder._id),
          razorpay_order_id,
        });
        return res.status(200).json({
          success: true,
          data: { kind: "test-series", order: testSeriesOrder },
          message: "Already verified.",
        });
      }

      // `durationDays` — TestSeries plans are validity in days (mockup shows
      // "10 days" / "Valid until Sep 17, 2026"), so use setDate, not setMonth.
      const plan = await TestSeriesPrice.findById(testSeriesOrder.planId)
        .select("durationDays")
        .lean();
      const durationDays = plan?.durationDays ?? 0;
      if (!plan) {
        logger.warn("verifyPayment: test-series plan lookup returned null", {
          orderId: String(testSeriesOrder._id),
          planId: String(testSeriesOrder.planId),
        });
      }

      testSeriesOrder.status = PackageCourseEbookOrderStatus.COMPLETE;
      testSeriesOrder.razorpayPaymentId = razorpay_payment_id;
      await testSeriesOrder.save();

      const startAt = new Date();

      // Extend-on-active: stack the purchased days onto an existing active
      // subscription rather than creating a second overlapping row (mirrors the
      // ebook/course branches). `durationDays` → setDate via extendEndAt asDays.
      const existingActive = await TestSeriesSubscription.findOne({
        customerId: testSeriesOrder.customerId,
        testSeriesId: testSeriesOrder.testSeriesId,
        status: true,
        endAt: { $gt: startAt },
      }).sort({ endAt: -1 });

      if (existingActive) {
        existingActive.endAt = extendEndAt({
          currentEndAt: existingActive.endAt,
          durationMonths: durationDays,
          asDays: true,
          now: startAt,
        });
        existingActive.price = (existingActive.price || 0) + (testSeriesOrder.orderPrice || 0);
        existingActive.orderId = testSeriesOrder._id;
        if (testSeriesOrder.promocodeId) existingActive.promocodeId = testSeriesOrder.promocodeId;
        await existingActive.save();

        logger.info("verifyPayment: test-series subscription extended existing", {
          orderId: String(testSeriesOrder._id),
          subscriptionId: String(existingActive._id),
          testSeriesId: String(testSeriesOrder.testSeriesId),
          customerId: String(testSeriesOrder.customerId),
          razorpay_order_id,
          razorpay_payment_id,
          durationDays,
          endAt: existingActive.endAt?.toISOString?.(),
        });

        return res.status(200).json({
          success: true,
          data: { kind: "test-series", order: testSeriesOrder, subscription: existingActive },
        });
      }

      const endAt = new Date(startAt);
      endAt.setDate(endAt.getDate() + durationDays);
      const subscription = await TestSeriesSubscription.create({
        orderId: testSeriesOrder._id,
        customerId: testSeriesOrder.customerId,
        testSeriesId: testSeriesOrder.testSeriesId,
        planId: testSeriesOrder.planId ?? null,
        price: testSeriesOrder.orderPrice,
        startAt,
        endAt,
        paymentType: PackageCourseEbookPaymentType.ONLINE,
        promocodeId: testSeriesOrder.promocodeId ?? null,
        status: true,
      });

      logger.info("verifyPayment: test-series order activated", {
        orderId: String(testSeriesOrder._id),
        subscriptionId: String(subscription._id),
        testSeriesId: String(testSeriesOrder.testSeriesId),
        customerId: String(testSeriesOrder.customerId),
        razorpay_order_id,
        razorpay_payment_id,
        durationDays,
        endAt: endAt.toISOString(),
      });

      return res.status(200).json({
        success: true,
        data: { kind: "test-series", order: testSeriesOrder, subscription },
      });
    }

    // Unreachable — TypeScript exhaustiveness only.
    logger.error("verifyPayment unhandled kind", { traceId, customerId: userId, razorpayOrderId: req.body?.razorpay_order_id });
    return res.status(500).json({ success: false, message: "Unhandled order kind." });
  } catch (e: any) {
    if (e.issues) { logger.warn("verifyPayment validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("verifyPayment failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e?.stack });
    return res.status(500).json({
      success: false,
      message: e?.message || "Verification failed.",
    });
  }
};
