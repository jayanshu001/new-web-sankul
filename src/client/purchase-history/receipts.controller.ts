import { Request, Response } from "express";
import mongoose from "mongoose";
import { BookOrder } from "../../models/book/BookOrder.model";
import { Book } from "../../models/book/Book.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (s?: string): boolean => !!s && /^[0-9a-fA-F]{24}$/.test(s);

// Receipts return a uniform JSON shape so the frontend can render a receipt
// screen and (later) generate a PDF locally. Server-side PDF can be swapped
// in without changing the URL.
type ReceiptResponse = {
  kind: "book" | "course" | "ebook" | "package";
  receiptId: string;
  purchasedAt: Date;
  paidAt: Date | null;
  status: string;
  customer: { id: string };
  payment: {
    method: string;
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
  };
  items: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totals: {
    subTotal: number;
    shipping?: number;
    discount?: number;
    grandTotal: number;
    currency: "INR";
  };
  extra?: Record<string, any>;
};

// GET /api/v1/client/purchase-history/books/:id/receipt
export const getBookReceipt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getBookReceipt invoked", { traceId, path: req.originalUrl, customerId: userId, orderId: id });

  try {
    if (!userId) { logger.warn("getBookReceipt unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("getBookReceipt invalid id", { traceId, customerId: userId, orderId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }

    const order: any = await BookOrder.findOne({ _id: id, customerId: userId }).lean();
    if (!order) { logger.warn("getBookReceipt not found", { traceId, customerId: userId, orderId: id }); return res.status(404).json({ success: false, message: "Order not found." }); }

    const items = (order.items || []).map((it: any) => ({
      name: it.name,
      qty: it.qty,
      unitPrice: it.price,
      lineTotal: it.price * it.qty,
    }));

    const data: ReceiptResponse = {
      kind: "book",
      receiptId: order.receiptId,
      purchasedAt: order.createdAt,
      paidAt: order.paidAt ?? null,
      status: order.status,
      customer: { id: String(order.customerId) },
      payment: {
        method: order.paymentMethod,
        razorpayOrderId: order.razorpayOrderId ?? null,
        razorpayPaymentId: order.razorpayPaymentId ?? null,
      },
      items,
      totals: {
        subTotal: order.totalDiscountedPrice,
        shipping: order.totalShippingPrice,
        discount: Math.max(0, (order.totalListPrice ?? 0) - (order.totalDiscountedPrice ?? 0)),
        grandTotal: order.amount,
        currency: "INR",
      },
      extra: {
        shippingId: order.shippingId,
        tracking: order.tracking,
      },
    };
    logger.info("getBookReceipt success", { traceId, customerId: userId, orderId: id });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getBookReceipt failed", { traceId, customerId: userId, orderId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/subscriptions/:id/receipt
export const getCourseReceipt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getCourseReceipt invoked", { traceId, path: req.originalUrl, customerId: userId, subscriptionId: id });

  try {
    if (!userId) { logger.warn("getCourseReceipt unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("getCourseReceipt invalid id", { traceId, customerId: userId, subscriptionId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }

    const sub: any = await PackageCourseSubscription.findOne({
      _id: id,
      customerId: userId,
      paymentStatus: "verified",
    }).lean();
    if (!sub) { logger.warn("getCourseReceipt not found", { traceId, customerId: userId, subscriptionId: id }); return res.status(404).json({ success: false, message: "Subscription not found." }); }

    const [price, course] = await Promise.all([
      PackageCourseEbookPrice.findById(sub.packageId).lean<any>(),
      sub.courseId ? Course.findById(sub.courseId).select("_id name author").lean<any>() : null,
    ]);
    // Prefer the sub's targetPackageId (package subs); fall back to the plan's
    // packageId chain (legacy paths).
    const targetPkgId = sub.targetPackageId
      ? String(sub.targetPackageId)
      : price?.packageId
      ? String(price.packageId)
      : null;
    const pkg: any = targetPkgId
      ? await Package.findById(targetPkgId).select("_id name").lean<any>()
      : null;

    const isPackageKind = !sub.courseId && !!pkg;
    const lineName =
      (course?.name && pkg?.name)
        ? `${course.name} — ${pkg.name}`
        : course?.name || pkg?.name || "Subscription";

    const data: ReceiptResponse = {
      kind: isPackageKind ? "package" : "course",
      receiptId: String(sub._id),
      purchasedAt: sub.createdAt,
      paidAt: sub.paidAt ?? null,
      status: sub.paymentStatus,
      customer: { id: String(sub.customerId) },
      payment: {
        method: "razorpay",
        razorpayOrderId: sub.razorpayOrderId ?? null,
        razorpayPaymentId: sub.razorpayPaymentId ?? null,
      },
      items: [
        {
          name: lineName,
          qty: 1,
          unitPrice: sub.paidAmount ?? 0,
          lineTotal: sub.paidAmount ?? 0,
        },
      ],
      totals: {
        subTotal: sub.paidAmount ?? 0,
        grandTotal: sub.paidAmount ?? 0,
        currency: "INR",
      },
      extra: {
        courseId: sub.courseId ?? null,
        targetPackageId: sub.targetPackageId ?? null,
        planId: sub.packageId,
        duration: price?.duration ?? null, // days
        startAt: sub.startAt,
        endAt: sub.endAt,
      },
    };
    logger.info("getCourseReceipt success", { traceId, customerId: userId, subscriptionId: id });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getCourseReceipt failed", { traceId, customerId: userId, subscriptionId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/ebooks/:id/receipt
export const getEbookReceipt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id || "");
  logger.info("getEbookReceipt invoked", { traceId, path: req.originalUrl, customerId: userId, orderId: id });

  try {
    if (!userId) { logger.warn("getEbookReceipt unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("getEbookReceipt invalid id", { traceId, customerId: userId, orderId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }

    const order: any = await EbookOrder.findOne({ _id: id, customerId: userId }).lean();
    if (!order) { logger.warn("getEbookReceipt not found", { traceId, customerId: userId, orderId: id }); return res.status(404).json({ success: false, message: "Order not found." }); }

    const [ebook, plan] = await Promise.all([
      Ebook.findById(order.ebookId).select("_id name author").lean<any>(),
      order.planId ? EbookPrice.findById(order.planId).lean<any>() : Promise.resolve(null),
    ]);

    const data: ReceiptResponse = {
      kind: "ebook",
      receiptId: String(order._id),
      purchasedAt: order.createdAt,
      paidAt: order.updatedAt ?? null,
      status: order.status,
      customer: { id: String(order.customerId) },
      payment: {
        method: order.paymentMethod,
        razorpayOrderId: order.razorpayOrderId ?? null,
        razorpayPaymentId: order.razorpayPaymentId ?? null,
      },
      items: [
        {
          name: ebook?.name ? `E-Book: ${ebook.name}` : "E-Book purchase",
          qty: 1,
          unitPrice: order.orderPrice,
          lineTotal: order.orderPrice,
        },
      ],
      totals: {
        subTotal: order.orderPrice,
        grandTotal: order.orderPrice,
        currency: "INR",
      },
      extra: {
        ebookId: order.ebookId,
        planId: order.planId,
        duration: plan?.duration ?? null,
        transactionId: order.transactionId ?? null,
      },
    };
    logger.info("getEbookReceipt success", { traceId, customerId: userId, orderId: id });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getEbookReceipt failed", { traceId, customerId: userId, orderId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Helper kept for the books-tab thumbnail lookup so the list endpoint stays lean.
export const lookupBookThumbnails = async (bookIds: string[]) => {
  if (!bookIds.length) return new Map<string, string | null>();
  const books = await Book.find({ _id: { $in: bookIds } })
    .select("_id thumbnail image")
    .lean();
  return new Map<string, string | null>(
    books.map((b: any) => [String(b._id), b.thumbnail || b.image || null])
  );
};
