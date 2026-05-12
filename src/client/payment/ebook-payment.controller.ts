import { Request, Response } from "express";
import { z } from "zod";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookOrderType,
  PaymentMethod,
} from "../../models/enums";
import { getRazorpay, razorpayResponseFor } from "./razorpay";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createEbookOrderSchema = z.object({
  // EbookPrice._id — the plan/duration row drives both price and access window.
  planId: objectId,
});

// POST /api/v1/client/payment/create-order/ebook
// Creates an EbookOrder in PENDING status and a Razorpay order. /verify (or the
// webhook) flips status to COMPLETE and provisions the EbookSubscription.
export const createEbookOrderPayment = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const rp = getRazorpay();
    if (!rp) {
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    const { planId } = createEbookOrderSchema.parse(req.body);

    const plan = await EbookPrice.findOne({ _id: planId, status: true });
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    }
    if (!plan.price || plan.price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan amount is zero — use the free-grant flow instead.",
      });
    }

    const ebook = await Ebook.findOne({ _id: plan.ebookId, status: true });
    if (!ebook) {
      return res.status(404).json({ success: false, message: "Ebook not found or inactive." });
    }

    // Block double-buy: if the customer has an active (un-expired) subscription
    // to this ebook, refuse so they don't pay twice for overlapping access.
    const now = new Date();
    const activeSub = await EbookSubscription.findOne({
      customerId,
      ebookId: plan.ebookId,
      status: true,
      endAt: { $gt: now },
    });
    if (activeSub) {
      return res.status(409).json({
        success: false,
        message: "You already have an active subscription to this ebook.",
      });
    }

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

    const rzpOrder = await rp.orders.create({
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
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    const message =
      e?.error?.description ||
      e?.message ||
      "Unknown error creating ebook payment order.";
    console.error("[payment/create-order/ebook] failed:", e);
    return res.status(500).json({ success: false, message });
  }
};
