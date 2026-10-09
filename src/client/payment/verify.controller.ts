// Client payments: Razorpay signature verify and order fulfilment.
import { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  findCourseOrderForVerify,
  verifyCourseOrderMysql,
  findPackageOrderForVerify,
  verifyPackageOrderMysql,
} from "../../modules/commerce-order/commerce-order.service";
import {
  findEbookOrderForVerify,
  verifyEbookOrderMysql,
} from "../../modules/ebook-order/ebook-order.service";
import {
  findBookOrderForVerify,
  verifyBookOrderMysql,
} from "../../modules/book-order/book-order.service";
import {
  findLiveCourseOrderForVerify,
  verifyLiveCourseOrderMysql,
} from "../../modules/live-course-order/live-course-order.service";
import * as tsOrderSql from "../../modules/test-series-order/test-series-order.service";
import { flushUserRouteCache } from "../../middlewares/autoFlush";
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

// Razorpay signs `${order_id}|${payment_id}` with HMAC-SHA256 keyed by key_secret.
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

type CrmParams = { userId: number } & Record<string, unknown>;
type Fulfilled = { message: string; log: Record<string, unknown>; crm?: CrmParams };
type VerifyStep = (razorpayOrderId: string, paymentId: string, customerId: number) => Promise<Fulfilled | null>;

// One step per order table: claim the order if this table owns the razorpay id, else
// return null so the next table is tried. Verifying a settled order is idempotent.
const step = <O extends { id: unknown }, R>(
  kind: string,
  find: (razorpayOrderId: string, customerId: number) => Promise<O | null>,
  settled: (o: O) => boolean,
  verify: (o: O, paymentId: string) => Promise<R>,
  describe: (o: O, r: R, razorpay_order_id: string, razorpay_payment_id: string) => Fulfilled
): VerifyStep => async (razorpay_order_id, razorpay_payment_id, customerId) => {
  const order = await find(razorpay_order_id, customerId);
  if (!order) return null;
  if (settled(order)) {
    logger.info(`verifyPayment: ${kind} order already verified (idempotent)`, { orderId: order.id, razorpay_order_id });
  }
  return describe(order, await verify(order, razorpay_payment_id), razorpay_order_id, razorpay_payment_id);
};

// Tried sequentially in this order; the first table that owns the id wins.
// findPackageOrderForVerify only matches package orders (plan has packageId, no courseId).
// The pending ws_live_course_order owns the razorpay id; verifying it creates the subscription.
const VERIFY_STEPS: VerifyStep[] = [
  step("course", findCourseOrderForVerify, (o) => o.paymentStatus !== "pending", verifyCourseOrderMysql, (o, sub, razorpay_order_id, razorpay_payment_id) => ({
    message: "verifyPayment: course subscription activated",
    log: { orderId: o.id, subscriptionId: sub._id, customerId: sub.customerId, razorpay_order_id, razorpay_payment_id, endAt: sub.endAt?.toISOString?.() },
    crm: { userId: sub.customerId, courseId: sub.courseId ?? undefined, planId: sub.packageId ?? undefined, amount: sub.paidAmount ?? undefined },
  })),
  step("package", findPackageOrderForVerify, (o) => o.paymentStatus !== "pending", verifyPackageOrderMysql, (o, sub, razorpay_order_id, razorpay_payment_id) => ({
    message: "verifyPayment: package subscription activated",
    log: { orderId: o.id, subscriptionId: sub._id, customerId: sub.customerId, razorpay_order_id, razorpay_payment_id, endAt: sub.endAt?.toISOString?.() },
    crm: { userId: sub.customerId, packageId: sub.targetPackageId ?? undefined, planId: sub.packageId ?? undefined, amount: sub.paidAmount ?? undefined },
  })),
  step("ebook", findEbookOrderForVerify, (o) => o.status !== "pending", verifyEbookOrderMysql, (o, order, razorpay_order_id, razorpay_payment_id) => ({
    message: "verifyPayment: ebook order activated",
    log: { orderId: o.id, customerId: order.customerId, ebookId: order.ebookId, razorpay_order_id, razorpay_payment_id },
  })),
  step("book", findBookOrderForVerify, (o) => o.status !== "pending", verifyBookOrderMysql, (o, order, razorpay_order_id, razorpay_payment_id) => ({
    message: "verifyPayment: book order verified",
    log: { orderId: o.id, customerId: order.customerId, trackingId: order.tracking.trackingId, razorpay_order_id, razorpay_payment_id },
  })),
  step("live-course", findLiveCourseOrderForVerify, (o) => !!o.status && o.status !== "pending", verifyLiveCourseOrderMysql, (_o, sub, razorpay_order_id, razorpay_payment_id) => ({
    message: "verifyPayment: live-course subscription activated",
    log: { subscriptionId: sub._id, customerId: sub.customerId, razorpay_order_id, razorpay_payment_id, endAt: sub.endAt?.toISOString?.() },
    crm: { userId: sub.customerId, liveCourseId: sub.liveCourseId, planId: sub.planId ?? undefined, amount: sub.paidAmount ?? undefined },
  })),
  // Verify folds-or-fresh into ws_test_series_subscription.
  step("test-series", tsOrderSql.findOrderForVerify, (o) => o.status !== "pending", tsOrderSql.verifyOrderMysql, (o, sub, razorpay_order_id, razorpay_payment_id) => ({
    message: "verifyPayment: test-series subscription activated",
    log: { orderId: o.id, subscriptionId: sub._id, customerId: sub.customerId, razorpay_order_id, razorpay_payment_id, endAt: sub.endAt?.toISOString?.() },
    crm: { userId: sub.customerId, testSeriesId: sub.testSeriesId, planId: sub.planId ?? undefined, amount: sub.price ?? undefined },
  })),
];

// HMAC-verifies the signature, then fulfils whichever local order owns this
// razorpay_order_id. Idempotent: re-verifying an already-paid order returns 200.
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
      queueCRMLead({ params: { userId }, leadType: CRM_LEAD_TYPE.PAYMENT_FAILED }, { traceId, userId });
      return res.status(400).json({
        success: false,
        message: "Signature verification failed.",
      });
    }

    const customerIdInt = Number(userId);
    if (Number.isInteger(customerIdInt)) {
      // Sequential, never parallel: table order is part of the ownership semantics.
      for (const run of VERIFY_STEPS) {
        const done = await run(razorpay_order_id, razorpay_payment_id, customerIdInt);
        if (!done) continue;
        logger.info(done.message, done.log);
        if (done.crm) {
          queueCRMLead({ params: done.crm, leadType: CRM_LEAD_TYPE.PAYMENT_SUCCESS }, { traceId, customerId: done.crm.userId });
        }
        // Entitlement changed → clear THIS buyer's cached catalog reads so the
        // next fetch shows isPurchased=true immediately (long TTL stays correct).
        await flushUserRouteCache(customerIdInt);
        return res.status(200).json({ success: true }); // ack-only; FE checks HTTP success
      }
    }

    logger.warn("verifyPayment no local order", { traceId, customerId: userId, razorpayOrderId: razorpay_order_id });
    return res.status(404).json({
      success: false,
      message: "No local order found for this Razorpay order id.",
    });
  } catch (e: any) {
    if (e.issues) { logger.warn("verifyPayment validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("verifyPayment failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e?.stack });
    return res.status(500).json({
      success: false,
      message: e?.message || "Verification failed.",
    });
  }
};
