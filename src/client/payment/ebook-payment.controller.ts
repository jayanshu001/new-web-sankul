import { Request, Response } from "express";
import { z } from "zod";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookOrderType,
  PaymentMethod,
} from "../../models/enums";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  isEbookOrderMysql,
  createEbookOrderMysql,
  findEbookPlanForOrder,
} from "../../modules/ebook-order/ebook-order.service";
import { findActiveEbookById } from "../../modules/catalog-ebook/catalog-ebook.service";

/** Non-null Razorpay client (the controller has already null-checked it). */
type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createEbookOrderSchema = z.object({
  // EbookPrice._id — the plan/duration row drives both price and access window.
  planId: objectId,
});

// MySQL ebook write path: the plan id is an INT (the migrated id-space).
const createEbookOrderMysqlSchema = z.object({
  planId: z.coerce.number().int().positive(),
});

// POST /api/v1/client/payment/create-order/ebook
// Creates an EbookOrder in PENDING status and a Razorpay order. /verify (or the
// webhook) flips status to COMPLETE and provisions the EbookSubscription.
export const createEbookOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createEbookOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createEbookOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createEbookOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    // ── MySQL ebook write path (ebook-order, flag-gated) ─────────────────────
    // Branch BEFORE the ObjectId parse — a MySQL plan id is an int, not 24-hex.
    if (isEbookOrderMysql()) {
      // C3 seam: coerce the string-typed token subject to the int customer id.
      const customerIdInt = Number(customerId);
      if (!Number.isInteger(customerIdInt)) {
        logger.warn("createEbookOrderPayment[mysql] non-int customer id", { traceId, customerId });
        return res.status(400).json({ success: false, message: "Invalid customer id." });
      }
      return createEbookOrderMysqlPath(req, res, { traceId, customerId: customerIdInt, rp });
    }

    const { planId } = createEbookOrderSchema.parse(req.body);

    const plan = await EbookPrice.findOne({ _id: planId, status: true });
    if (!plan) { logger.warn("createEbookOrderPayment plan not found", { traceId, customerId, planId }); return res.status(404).json({ success: false, message: "Plan not found or inactive." }); }
    if (!plan.price || plan.price <= 0) {
      logger.warn("createEbookOrderPayment zero price", { traceId, customerId, planId });
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const ebook = await Ebook.findOne({ _id: plan.ebookId, status: true });
    if (!ebook) { logger.warn("createEbookOrderPayment ebook not found", { traceId, customerId, ebookId: plan.ebookId }); return res.status(404).json({ success: false, message: "Ebook not found or inactive." }); }

    // Re-purchasing an active ebook is an "Extend Validity" action, NOT a
    // double-buy error. We create a fresh pending order regardless; /payment/verify
    // (and the webhook) folds the purchased days onto the existing active
    // subscription (extending its endAt) instead of creating a second row. See
    // verify.controller / webhook.controller ebook branch.
    const order = await EbookOrder.create({
      customerId,
      ebookId: plan.ebookId,
      planId: plan._id,
      paymentMethod: PaymentMethod.RAZORPAY,
      orderType: PackageCourseEbookOrderType.PURCHASE,
      orderPrice: plan.price,
      status: PackageCourseEbookOrderStatus.PENDING,
    });

    const receiptId = `ebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(plan.price * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        kind: "ebook",
        ebookOrderId: String(order._id),
        ebookId: String(plan.ebookId),
        planId: String(plan._id),
        customerId: String(customerId),
      },
    });

    order.razorpayOrderId = rzpOrder.id;
    await order.save();

    logger.info("createEbookOrderPayment success", { traceId, customerId, orderId: order._id, razorpayOrderId: rzpOrder.id, amount: plan.price });
    return res.status(201).json({
      success: true,
      data: {
        ebookOrderId: order._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: plan.price,
        ebook: {
          _id: ebook._id,
          name: (ebook as any).name,
        },
        plan: {
          _id: plan._id,
          duration: plan.duration,
          price: plan.price,
        },
      },
    });
  } catch (e: any) {
    if (e.issues) { logger.warn("createEbookOrderPayment validation failed", { traceId, customerId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating ebook payment order.";
    logger.error("createEbookOrderPayment failed", { traceId, customerId, error: message, stack: e?.stack });
    return res.status(500).json({ success: false, message });
  }
};

// MySQL ebook create-order. Reads plan + ebook from MySQL, writes the pending
// ws_ebook_order row, creates the Razorpay order, returns the SAME response shape
// as the Mongo branch (ebookOrderId = the MySQL order id). /verify (ebook branch)
// completes it. Contract-safe: the client only round-trips the razorpay order id.
const createEbookOrderMysqlPath = async (
  req: Request,
  res: Response,
  ctx: { traceId?: string; customerId: number; rp: RazorpayClient }
) => {
  const { traceId, customerId, rp } = ctx;
  const { planId } = createEbookOrderMysqlSchema.parse(req.body);

  const plan = await findEbookPlanForOrder(planId);
  if (!plan) {
    logger.warn("createEbookOrderPayment[mysql] plan invalid", { traceId, customerId, planId });
    return res.status(404).json({
      success: false,
      message: "Plan not found, not an ebook plan, or zero price.",
    });
  }

  const ebook = await findActiveEbookById(plan.ebookId);
  if (!ebook) {
    logger.warn("createEbookOrderPayment[mysql] ebook not found", { traceId, customerId, ebookId: plan.ebookId });
    return res.status(404).json({ success: false, message: "Ebook not found or inactive." });
  }

  const receiptId = `ebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rzpOrder = await createRazorpayOrder(rp, {
    amount: Math.round(plan.price * 100), // paise
    currency: "INR",
    receipt: receiptId,
    notes: {
      kind: "ebook",
      ebookId: String(plan.ebookId),
      planId: String(planId),
      customerId: String(customerId),
    },
  });

  const { orderId } = await createEbookOrderMysql({
    customerId,
    planId,
    orderPrice: plan.price,
    razorpayOrderId: rzpOrder.id,
    uniqueId: receiptId,
  });

  logger.info("createEbookOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount: plan.price });
  return res.status(201).json({
    success: true,
    data: {
      ebookOrderId: String(orderId),
      receiptId,
      razorpay: razorpayResponseFor(rzpOrder),
      amountInRupees: plan.price,
      ebook: {
        _id: ebook._id,
        name: ebook.name,
      },
      plan: {
        _id: String(planId),
        duration: plan.duration,
        price: plan.price,
      },
    },
  });
};
