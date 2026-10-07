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

    // Each block below claims the order if its table owns this razorpay id, else falls through.
    {
      
      const customerIdInt = Number(userId);
      const mysqlCourseOrder = Number.isInteger(customerIdInt)
        ? await findCourseOrderForVerify(razorpay_order_id, customerIdInt)
        : null;
      if (mysqlCourseOrder) {
        if (mysqlCourseOrder.paymentStatus !== "pending") {
          logger.info("verifyPayment: course order already verified (idempotent, mysql)", {
            orderId: mysqlCourseOrder.id,
            razorpay_order_id,
          });
        }
        const subscription = await verifyCourseOrderMysql(
          mysqlCourseOrder,
          razorpay_payment_id
        );
        logger.info("verifyPayment: course subscription activated (mysql)", {
          orderId: mysqlCourseOrder.id,
          subscriptionId: subscription._id,
          customerId: subscription.customerId,
          razorpay_order_id,
          razorpay_payment_id,
          endAt: subscription.endAt?.toISOString?.(),
        });
        queueCRMLead(
          { params: { userId: subscription.customerId, courseId: subscription.courseId ?? undefined, planId: subscription.packageId ?? undefined, amount: subscription.paidAmount ?? undefined }, leadType: CRM_LEAD_TYPE.PAYMENT_SUCCESS },
          { traceId, customerId: subscription.customerId }
        );
        // Entitlement changed → clear THIS buyer's cached catalog reads so the
        // next fetch shows isPurchased=true immediately (long TTL stays correct).
        await flushUserRouteCache(customerIdInt);
        return res.status(200).json({ success: true }); // ack-only; FE checks HTTP success
      }
    }

    // findPackageOrderForVerify only matches package orders (plan has packageId, no courseId).
    {
      const customerIdInt = Number(userId);
      const mysqlPackageOrder = Number.isInteger(customerIdInt)
        ? await findPackageOrderForVerify(razorpay_order_id, customerIdInt)
        : null;
      if (mysqlPackageOrder) {
        if (mysqlPackageOrder.paymentStatus !== "pending") {
          logger.info("verifyPayment: package order already verified (idempotent, mysql)", { orderId: mysqlPackageOrder.id, razorpay_order_id });
        }
        const subscription = await verifyPackageOrderMysql(mysqlPackageOrder, razorpay_payment_id);
        logger.info("verifyPayment: package subscription activated (mysql)", { orderId: mysqlPackageOrder.id, subscriptionId: subscription._id, customerId: subscription.customerId, razorpay_order_id, razorpay_payment_id, endAt: subscription.endAt?.toISOString?.() });
        queueCRMLead(
          { params: { userId: subscription.customerId, packageId: subscription.targetPackageId ?? undefined, planId: subscription.packageId ?? undefined, amount: subscription.paidAmount ?? undefined }, leadType: CRM_LEAD_TYPE.PAYMENT_SUCCESS },
          { traceId, customerId: subscription.customerId }
        );
        await flushUserRouteCache(customerIdInt);
        return res.status(200).json({ success: true }); // ack-only; FE checks HTTP success
      }
    }

    
    {
      const customerIdInt = Number(userId);
      const mysqlEbookOrder = Number.isInteger(customerIdInt)
        ? await findEbookOrderForVerify(razorpay_order_id, customerIdInt)
        : null;
      if (mysqlEbookOrder) {
        if (mysqlEbookOrder.status !== "pending") {
          logger.info("verifyPayment: ebook order already verified (idempotent, mysql)", {
            orderId: mysqlEbookOrder.id,
            razorpay_order_id,
          });
        }
        const order = await verifyEbookOrderMysql(mysqlEbookOrder, razorpay_payment_id);
        logger.info("verifyPayment: ebook order activated (mysql)", {
          orderId: mysqlEbookOrder.id,
          customerId: order.customerId,
          ebookId: order.ebookId,
          razorpay_order_id,
          razorpay_payment_id,
        });
        await flushUserRouteCache(customerIdInt);
        return res.status(200).json({ success: true }); // ack-only; FE checks HTTP success
      }
    }

    
    {
      const customerIdInt = Number(userId);
      const mysqlBookOrder = Number.isInteger(customerIdInt)
        ? await findBookOrderForVerify(razorpay_order_id, customerIdInt)
        : null;
      if (mysqlBookOrder) {
        if (mysqlBookOrder.status !== "pending") {
          logger.info("verifyPayment: book order already verified (idempotent, mysql)", {
            orderId: mysqlBookOrder.id,
            razorpay_order_id,
          });
        }
        const order = await verifyBookOrderMysql(mysqlBookOrder, razorpay_payment_id);
        logger.info("verifyPayment: book order verified (mysql)", {
          orderId: mysqlBookOrder.id,
          customerId: order.customerId,
          trackingId: order.tracking.trackingId,
          razorpay_order_id,
          razorpay_payment_id,
        });
        await flushUserRouteCache(customerIdInt);
        return res.status(200).json({ success: true }); // ack-only; FE checks HTTP success
      }
    }

    // The pending ws_live_course_order owns the razorpay id; verifying it creates the subscription.
    {
      const customerIdInt = Number(userId);
      const mysqlLiveOrder = Number.isInteger(customerIdInt)
        ? await findLiveCourseOrderForVerify(razorpay_order_id, customerIdInt)
        : null;
      if (mysqlLiveOrder) {
        if (mysqlLiveOrder.status && mysqlLiveOrder.status !== "pending") {
          logger.info("verifyPayment: live-course order already complete (idempotent, mysql)", { orderId: mysqlLiveOrder.id, razorpay_order_id });
        }
        const subscription = await verifyLiveCourseOrderMysql(mysqlLiveOrder, razorpay_payment_id);
        logger.info("verifyPayment: live-course subscription activated (mysql)", { subscriptionId: subscription._id, customerId: subscription.customerId, razorpay_order_id, razorpay_payment_id, endAt: subscription.endAt?.toISOString?.() });
        queueCRMLead(
          { params: { userId: subscription.customerId, liveCourseId: subscription.liveCourseId, planId: subscription.planId ?? undefined, amount: subscription.paidAmount ?? undefined }, leadType: CRM_LEAD_TYPE.PAYMENT_SUCCESS },
          { traceId, customerId: subscription.customerId }
        );
        await flushUserRouteCache(customerIdInt);
        return res.status(200).json({ success: true }); // ack-only; FE checks HTTP success
      }
    }

    // Verify folds-or-fresh into ws_test_series_subscription.
    {
      const customerIdInt = Number(userId);
      const mysqlTsOrder = Number.isInteger(customerIdInt)
        ? await tsOrderSql.findOrderForVerify(razorpay_order_id, customerIdInt)
        : null;
      if (mysqlTsOrder) {
        if (mysqlTsOrder.status !== "pending") {
          logger.info("verifyPayment: test-series order already verified (idempotent, mysql)", { orderId: mysqlTsOrder.id, razorpay_order_id });
        }
        const subscription = await tsOrderSql.verifyOrderMysql(mysqlTsOrder, razorpay_payment_id);
        logger.info("verifyPayment: test-series subscription activated (mysql)", { orderId: mysqlTsOrder.id, subscriptionId: subscription._id, customerId: subscription.customerId, razorpay_order_id, razorpay_payment_id, endAt: subscription.endAt?.toISOString?.() });
        queueCRMLead(
          { params: { userId: subscription.customerId, testSeriesId: subscription.testSeriesId, planId: subscription.planId ?? undefined, amount: subscription.price ?? undefined }, leadType: CRM_LEAD_TYPE.PAYMENT_SUCCESS },
          { traceId, customerId: subscription.customerId }
        );
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
