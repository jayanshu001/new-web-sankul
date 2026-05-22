import { Request, Response } from "express";
import { z } from "zod";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createPackageOrderSchema = z.object({
  // PackageCourseEbookPrice._id — the specific plan/duration row picked.
  // Same naming as the course endpoint for consistency; the plan row decides
  // whether this is a course or package purchase via which target id it carries.
  packageId: objectId,
});

// POST /api/v1/client/payment/create-order/package
// Mirror of /create-order/course but for plan rows whose `packageId` (target
// Package) is set instead of `courseId`. Creates a PackageCourseSubscription
// in paymentStatus="pending" and a Razorpay order. /verify flips it to verified.
export const createPackageOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createPackageOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createPackageOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createPackageOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    const { packageId } = createPackageOrderSchema.parse(req.body);

    const plan = await PackageCourseEbookPrice.findOne({ _id: packageId, status: true });
    if (!plan) { logger.warn("createPackageOrderPayment plan not found", { traceId, customerId, packageId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.packageId) { logger.warn("createPackageOrderPayment not a package plan", { traceId, customerId, packageId }); return res.status(400).json({ success: false, message: "This plan is not a package plan. Use the matching endpoint for course or ebook plans." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("createPackageOrderPayment zero price", { traceId, customerId, packageId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const pkg = await Package.findOne({ _id: plan.packageId, active: true });
    if (!pkg) { logger.warn("createPackageOrderPayment package not found", { traceId, customerId, packageId: plan.packageId }); return res.status(404).json({ success: false, message: "Package not found or inactive." }); }

    // Block double-buy: same rule as the course endpoint. If the customer has
    // a verified active subscription to this exact plan row, refuse.
    const existingPaid = await PackageCourseSubscription.findOne({
      customerId,
      targetPackageId: plan.packageId,
      packageId: plan._id,
      status: true,
      paymentStatus: "verified",
    });
    if (existingPaid) {
      logger.warn("createPackageOrderPayment already subscribed", { traceId, customerId, packageId, existingId: existingPaid._id });
      return res.status(409).json({
        success: false,
        message: "You already have an active subscription to this plan.",
      });
    }

    const subscription = await PackageCourseSubscription.create({
      customerId,
      targetPackageId: plan.packageId,
      packageId: plan._id,
      paidAmount: plan.price,
      paymentStatus: "pending",
      status: true,
    });

    const receiptId = `package-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(plan.price * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "package",
        subscriptionId: String(subscription._id),
        targetPackageId: String(plan.packageId),
        packageId: String(plan._id),
        customerId: String(customerId),
      },
    });

    subscription.razorpayOrderId = rzpOrder.id;
    await subscription.save();

    logger.info("createPackageOrderPayment success", { traceId, customerId, subscriptionId: subscription._id, razorpayOrderId: rzpOrder.id, amount: plan.price });
    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: plan.price,
        package: {
          _id: pkg._id,
          name: pkg.name,
        },
        plan: {
          _id: plan._id,
          duration: plan.duration,
          price: plan.price,
        },
      },
    });
  } catch (e: any) {
    if (e.issues) { logger.warn("createPackageOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating package payment order.";
    logger.error("createPackageOrderPayment failed", { traceId, customerId, error: message, stack: e?.stack });
    return res.status(500).json({ success: false, message });
  }
};
