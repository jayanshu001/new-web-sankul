import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  isCommerceOrderMysql,
  createCourseOrderMysql,
  findCoursePlanForOrder,
} from "../../modules/commerce-order/commerce-order.service";
import { findCourseById } from "../../modules/catalog-course/catalog-course.service";

/** Non-null Razorpay client (the controller has already null-checked it). */
type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createCourseOrderSchema = z.object({
  // PackageCourseEbookPrice._id — the specific plan/duration the user picked.
  // We deliberately key on this rather than (courseId, duration) because the
  // PackageCourseEbookPrice row is the single source of truth for the price.
  packageId: objectId,
});

// MySQL course write path: the plan id is an INT (the migrated id-space), not an
// ObjectId. Accept a positive-int packageId (as number or numeric string).
const createCourseOrderMysqlSchema = z.object({
  packageId: z.coerce.number().int().positive(),
});

// POST /api/v1/client/payment/create-order/course
// Creates a PackageCourseSubscription in paymentStatus="pending" and a Razorpay
// order. After /verify flips paymentStatus → "verified", access is granted.
export const createCourseOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createCourseOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createCourseOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createCourseOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    // ── MySQL course write path (commerce-order, flag-gated) ─────────────────
    // When ON, the client sends an INT plan id (the migrated id-space), the plan
    // + course are read from MySQL, and the pending order row is written to
    // ws_package_course_order. /payment/verify (course branch) completes it.
    // Response stays shape-compatible with the Mongo branch below. We branch
    // BEFORE the ObjectId schema parse — a MySQL plan id is an int, not a 24-hex.
    if (isCommerceOrderMysql()) {
      // C3 seam: coerce the string-typed token subject to the int customer id.
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) {
        logger.warn("createCourseOrderPayment[mysql] non-int customer id", { traceId, customerId });
        return res.status(400).json({ success: false, message: "Invalid customer id." });
      }
      return createCourseOrderMysqlPath(req, res, { traceId, customerId: customerIdInt, rp });
    }

    const { packageId } = createCourseOrderSchema.parse(req.body);

    const plan = await PackageCourseEbookPrice.findOne({ _id: packageId, status: true });
    if (!plan) { logger.warn("createCourseOrderPayment plan not found", { traceId, customerId, packageId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.courseId) { logger.warn("createCourseOrderPayment not a course plan", { traceId, customerId, packageId }); return res.status(400).json({ success: false, message: "This plan is not a course plan. Use the matching endpoint for ebook plans." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("createCourseOrderPayment zero price", { traceId, customerId, packageId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const course = await Course.findOne({ _id: plan.courseId, status: true });
    if (!course) { logger.warn("createCourseOrderPayment course not found", { traceId, customerId, courseId: plan.courseId }); return res.status(404).json({ success: false, message: "Course not found or inactive." }); }

    // Re-purchasing an active plan is an "Extend Validity" action, NOT a
    // double-buy error. We create a fresh pending row regardless; /payment/verify
    // folds the purchased window onto the existing active subscription (extending
    // its endAt) and retires this row, so the customer never ends up with two
    // overlapping cards. See verify.controller course/package branch.

    // Create local row first (pending). Verify endpoint flips it to verified.
    const subscription = await PackageCourseSubscription.create({
      customerId,
      courseId: plan.courseId,
      packageId: plan._id,
      paidAmount: plan.price,
      paymentStatus: "pending",
      status: true,
    });

    const receiptId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(plan.price * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "course",
        subscriptionId: String(subscription._id),
        courseId: String(plan.courseId),
        packageId: String(plan._id),
        customerId: String(customerId),
      },
    });

    subscription.razorpayOrderId = rzpOrder.id;
    await subscription.save();

    logger.info("createCourseOrderPayment success", { traceId, customerId, subscriptionId: subscription._id, razorpayOrderId: rzpOrder.id, amount: plan.price });
    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: plan.price,
        course: {
          _id: course._id,
          name: course.name,
        },
        plan: {
          _id: plan._id,
          duration: plan.duration,
          price: plan.price,
        },
      },
    });
  } catch (e: any) {
    if (e.issues) { logger.warn("createCourseOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("createCourseOrderPayment failed", { traceId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// MySQL course create-order. Reads plan + course from MySQL, writes the pending
// ws_package_course_order row, creates the Razorpay order, and returns the SAME
// response shape as the Mongo branch (subscriptionId here is the ORDER id — the
// entitlement subscription row is created at verify time, not now). The client
// only round-trips the razorpay order id to /verify, so this is contract-safe.
const createCourseOrderMysqlPath = async (
  req: Request,
  res: Response,
  ctx: { traceId?: string; customerId: number; rp: RazorpayClient }
) => {
  const { traceId, customerId, rp } = ctx;
  const { packageId } = createCourseOrderMysqlSchema.parse(req.body);

  const plan = await findCoursePlanForOrder(packageId);
  if (!plan) {
    logger.warn("createCourseOrderPayment[mysql] plan invalid", { traceId, customerId, packageId });
    return res.status(404).json({
      success: false,
      message: "Plan not found, not a course plan, or zero price.",
    });
  }

  const course = await findCourseById(plan.courseId);
  if (!course) {
    logger.warn("createCourseOrderPayment[mysql] course not found", { traceId, customerId, courseId: plan.courseId });
    return res.status(404).json({ success: false, message: "Course not found or inactive." });
  }

  const receiptId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rzpOrder = await createRazorpayOrder(rp, {
    amount: Math.round(plan.price * 100), // paise
    currency: "INR",
    receipt: receiptId,
    notes: {
      kind: "course",
      courseId: String(plan.courseId),
      packageId: String(packageId),
      customerId: String(customerId),
    },
  });

  // Persist the pending order with its razorpay id so /verify can find it.
  const { orderId } = await createCourseOrderMysql({
    customerId,
    planId: packageId,
    price: plan.price,
    razorpayOrderId: rzpOrder.id,
  });

  logger.info("createCourseOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: plan.price });
  return res.status(201).json({
    success: true,
    data: {
      subscriptionId: String(orderId),
      receiptId,
      razorpay: razorpayResponseFor(rzpOrder),
      amountInRupees: plan.price,
      course: {
        _id: course._id,
        name: course.name,
      },
      plan: {
        _id: String(packageId),
        duration: plan.duration,
        price: plan.price,
      },
    },
  });
};
