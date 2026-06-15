import { Request, Response } from "express";
import { z } from "zod";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { resolveLivePromo } from "../live-course/promo";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createPackageOrderSchema = z.object({
  // PackageCourseEbookPrice._id — the specific plan/duration row picked.
  // Same naming as the course endpoint for consistency; the plan row decides
  // whether this is a course or package purchase via which target id it carries.
  packageId: objectId,
  // Optional delivery address (a CustomerAddress._id) for "With Materials"
  // plans. Optional at the schema level; validated for ownership only when sent.
  // Stored as customerShippingId, matching the admin create-subscription flow.
  customerShippingId: objectId.optional(),
  // Optional promo code. When present the discount is RE-VALIDATED server-side
  // here (the /promocodes/apply preview is never trusted) and the Razorpay order
  // is created for the reduced amount. Mirrors the live-course flow.
  promocode: z.string().trim().min(1).optional(),
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

    const { packageId, customerShippingId, promocode } = createPackageOrderSchema.parse(req.body);

    if (customerShippingId) {
      const addr = await CustomerAddress.findOne({ _id: customerShippingId, customerId }).select("_id");
      if (!addr) {
        logger.warn("createPackageOrderPayment address not owned", { traceId, customerId, customerShippingId });
        return res.status(400).json({ success: false, message: "Delivery address does not belong to this customer." });
      }
    }

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

    // Resolve the promo code (if any) against THIS package and derive the amount
    // to charge. The discount is always re-validated here — the preview endpoint's
    // result is never trusted. Mirrors createLiveCourseOrderPayment.
    let chargeAmount = plan.price;
    let promocodeId: string | null = null;
    let originalAmount: number | null = null;
    let discountAmount: number | null = null;
    if (promocode) {
      const { result, error } = await resolveLivePromo(promocode, plan.price, {
        type: "package",
        id: String(plan.packageId),
      });
      if (error || !result) {
        logger.warn("createPackageOrderPayment promo rejected", { traceId, customerId, promocode, error });
        return res.status(400).json({ success: false, message: error ?? "Invalid promo code." });
      }
      // Razorpay rejects sub-₹1 orders; a code that zeroes the price can't go
      // through online checkout — admin should free-grant instead.
      if (result.finalAmount < 1) {
        logger.warn("createPackageOrderPayment promo zeroes amount", { traceId, customerId, promocode });
        return res.status(400).json({
          success: false,
          message: "This promo code reduces the price below the minimum payable amount. Please contact support.",
        });
      }
      chargeAmount = result.finalAmount;
      promocodeId = String(result.promo._id);
      originalAmount = result.originalAmount;
      discountAmount = result.discountAmount;
    }

    // Re-purchasing an active plan is an "Extend Validity" action, NOT a
    // double-buy error. We create a fresh pending row regardless; /payment/verify
    // folds the purchased window onto the existing active subscription (extending
    // its endAt) and retires this row, so the customer never ends up with two
    // overlapping cards. See verify.controller course/package branch.
    const subscription = await PackageCourseSubscription.create({
      customerId,
      targetPackageId: plan.packageId,
      packageId: plan._id,
      promocodeId,
      originalAmount,
      discountAmount,
      paidAmount: chargeAmount,
      paymentStatus: "pending",
      status: true,
      withMaterial: !!plan.withMaterial,
      customerShippingId: customerShippingId ?? null,
    });

    const receiptId = `package-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(chargeAmount * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "package",
        subscriptionId: String(subscription._id),
        targetPackageId: String(plan.packageId),
        packageId: String(plan._id),
        customerId: String(customerId),
        ...(promocodeId ? { promocodeId } : {}),
      },
    });

    subscription.razorpayOrderId = rzpOrder.id;
    await subscription.save();

    logger.info("createPackageOrderPayment success", { traceId, customerId, subscriptionId: subscription._id, razorpayOrderId: rzpOrder.id, amount: chargeAmount });
    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        // The amount actually charged (post-discount). `plan.price` below is the
        // pre-discount MRP for display.
        amountInRupees: chargeAmount,
        package: {
          _id: pkg._id,
          name: pkg.name,
        },
        plan: {
          _id: plan._id,
          duration: plan.duration,
          price: plan.price,
        },
        // Present only when a promo code was applied.
        promo: promocodeId
          ? { promocodeId, originalAmount, discountAmount, finalAmount: chargeAmount }
          : null,
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
