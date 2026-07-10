import { Request, Response } from "express";
import { z } from "zod";
import { resolvePromoForPlanSql, addressBelongsToCustomerSql } from "../../modules/promo-code/promo-code.service";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  createCourseOrderMysql,
  findCoursePlanForOrder,
} from "../../modules/commerce-order/commerce-order.service";
import { findCourseById } from "../../modules/catalog-course/catalog-course.service";

/** Non-null Razorpay client (the controller has already null-checked it). */
type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;

// MySQL course write path: the plan id is an INT (the migrated id-space), not an
// ObjectId. Accept a positive-int packageId (as number or numeric string) plus
// the same optional promocode + delivery-address fields as the Mongo branch.
const createCourseOrderMysqlSchema = z.object({
  packageId: z.coerce.number().int().positive(),
  customerShippingId: z.coerce.number().int().positive().optional(),
  promocode: z.string().trim().min(1).optional(),
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

    // ── MySQL course write path (commerce-order) ─────────────────────────────
    // The client sends an INT plan id (the migrated id-space), the plan + course
    // are read from MySQL, and the pending order row is written to
    // ws_package_course_order. /payment/verify (course branch) completes it.
    // C3 seam: coerce the string-typed token subject to the int customer id.
    const customerIdInt = Number(customerId);
    if (!Number.isInteger(customerIdInt)) {
      logger.warn("createCourseOrderPayment[mysql] non-int customer id", { traceId, customerId });
      return res.status(400).json({ success: false, message: "Invalid customer id." });
    }
    return createCourseOrderMysqlPath(req, res, { traceId, customerId: customerIdInt, rp });
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
  const { packageId, customerShippingId, promocode } = createCourseOrderMysqlSchema.parse(req.body);

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

  // Validate the delivery address (when supplied) belongs to this customer (SQL).
  if (customerShippingId) {
    const ok = await addressBelongsToCustomerSql(customerShippingId, customerId);
    if (!ok) return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
  }

  // Resolve the promo code (if any) against THIS course; charge the reduced
  // amount. Re-validated here — the /promocodes/apply preview is never trusted.
  let chargeAmount = plan.price;
  let promocodeIdNum: number | null = null;
  let originalAmount: number | null = null;
  let discountAmount: number | null = null;
  if (promocode) {
    const { result, error } = await resolvePromoForPlanSql(promocode, plan.price, { type: "course", id: plan.courseId }, packageId, Number(customerId));
    if (error || !result) {
      logger.warn("createCourseOrderPayment[mysql] promo rejected", { traceId, customerId, promocode, error });
      return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
    }
    if (result.finalAmount < 1) return res.status(400).json({ success: false, message: "This promo code reduces the price below the minimum payable amount. Please contact support." });
    chargeAmount = result.finalAmount;
    const pid = Number(result.promo._id);
    promocodeIdNum = Number.isInteger(pid) && pid > 0 ? pid : null;
    originalAmount = result.originalAmount;
    discountAmount = result.discountAmount;
  }

  const receiptId = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rzpOrder = await createRazorpayOrder(rp, {
    amount: Math.round(chargeAmount * 100), // paise
    currency: "INR",
    receipt: receiptId,
    notes: {
      kind: "course",
      courseId: String(plan.courseId),
      packageId: String(packageId),
      customerId: String(customerId),
      ...(promocodeIdNum ? { promocodeId: String(promocodeIdNum) } : {}),
    },
  });

  // Persist the pending order with its razorpay id so /verify can find it.
  const { orderId } = await createCourseOrderMysql({
    customerId,
    planId: packageId,
    price: chargeAmount,
    razorpayOrderId: rzpOrder.id,
    customerShippingId: customerShippingId ?? null,
  });

  logger.info("createCourseOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
  return res.status(201).json({
    success: true,
    data: {
      subscriptionId: String(orderId),
      receiptId,
      razorpay: razorpayResponseFor(rzpOrder),
      amountInRupees: chargeAmount,
      course: {
        _id: course._id,
        name: course.name,
      },
      plan: {
        _id: String(packageId),
        duration: plan.duration,
        price: plan.price,
      },
      promo: promocodeIdNum
        ? { promocodeId: String(promocodeIdNum), originalAmount, discountAmount, finalAmount: chargeAmount }
        : null,
    },
  });
};
