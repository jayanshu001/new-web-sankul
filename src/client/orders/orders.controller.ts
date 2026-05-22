import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { promoCovers, computePromoDiscount } from "../promocode/applies-to";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookPaymentType,
  PaymentMethod,
} from "../../models/enums";
import {
  placeCourseOrderSchema,
  placeEbookOrderSchema,
  verifyPaymentSchema,
} from "./orders.validation";
import { creditReferrer } from "../referral/credit-referrer";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

interface PriceResolution {
  finalPrice: number;
  promocodeId: Types.ObjectId | null;
  promoterId: Types.ObjectId | null;
  referrerId: Types.ObjectId | null;
  customerPercentage: number | null;
}

async function resolveFinalPrice(opts: {
  basePrice: number;
  cart: { type: "package" | "course" | "liveCourse"; id: string } | null;
  promocodeRaw?: string;
  userId?: string;
}): Promise<PriceResolution> {
  const { basePrice, cart, promocodeRaw, userId } = opts;
  const empty: PriceResolution = {
    finalPrice: basePrice,
    promocodeId: null,
    promoterId: null,
    referrerId: null,
    customerPercentage: null,
  };
  if (!promocodeRaw) return empty;
  const code = promocodeRaw.toUpperCase();
  const now = new Date();

  const [promo, referralCustomer, referralProgram] = await Promise.all([
    PromoCode.findOne({
      promocode: code,
      status: true,
      promo_start_at: { $lt: now },
      promo_expire_at: { $gt: now },
    }),
    Customer.findOne({ referralCode: code, isAccountDeleted: false, status: true }).lean(),
    ReferralProgram.findOne({ name: "student", status: true }).lean(),
  ]);

  if (promo) {
    if (!cart) return empty;
    if (!promoCovers(promo, cart)) return empty;
    const discount = computePromoDiscount(promo, basePrice);
    return {
      finalPrice: Math.max(0, basePrice - discount),
      promocodeId: promo._id as Types.ObjectId,
      promoterId: (promo.promoterId ?? null) as Types.ObjectId | null,
      referrerId: null,
      customerPercentage: promo.discountType === "percentage" ? promo.discountValue : null,
    };
  }

  if (referralCustomer && referralProgram) {
    if (userId && String(userId) === String(referralCustomer._id)) return empty;
    if (basePrice > referralProgram.minimumPrice) {
      const discount = Math.round(
        (basePrice * referralProgram.referralDiscount) / 100
      );
      return {
        ...empty,
        finalPrice: Math.max(0, basePrice - discount),
        referrerId: referralCustomer._id as Types.ObjectId,
        customerPercentage: referralProgram.referralDiscount,
      };
    }
    return { ...empty, referrerId: referralCustomer._id as Types.ObjectId };
  }

  return empty;
}

// POST /api/v1/client/orders/course
export const placeCourseOrder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info("placeCourseOrder invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("placeCourseOrder unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const data = placeCourseOrderSchema.parse(req.body);

    const plan = await PackageCourseEbookPrice.findById(data.planId);
    if (!plan || !plan.status) { logger.warn("placeCourseOrder plan not found", { traceId, customerId: userId, planId: data.planId }); return res.status(404).json({ success: false, message: "Plan not found." }); }

    if (data.courseId && String(plan.courseId) !== data.courseId) { logger.warn("placeCourseOrder course mismatch", { traceId, customerId: userId, planId: data.planId, courseId: data.courseId }); return res.status(400).json({ success: false, message: "Plan does not belong to this course." }); }
    if (data.packageId && String(plan.packageId) !== data.packageId) { logger.warn("placeCourseOrder package mismatch", { traceId, customerId: userId, planId: data.planId, packageId: data.packageId }); return res.status(400).json({ success: false, message: "Plan does not belong to this package." }); }

    // Resolve the cart entity for appliesTo matching. Course id (if any)
    // wins over package id — a plan can only belong to one parent.
    const cartEntityId = data.courseId || data.packageId || null;
    const cartType: "course" | "package" | null = data.courseId
      ? "course"
      : data.packageId
      ? "package"
      : null;

    const priceResolution = await resolveFinalPrice({
      basePrice: plan.price,
      cart: cartEntityId && cartType ? { type: cartType, id: String(cartEntityId) } : null,
      promocodeRaw: data.promocode,
      userId,
    });
    const { finalPrice } = priceResolution;

    const isFree = finalPrice === 0 || data.paymentMethod === PaymentMethod.FREE;
    const paymentDone =
      isFree ||
      data.paymentMethod === PaymentMethod.BANK ||
      data.paymentMethod === PaymentMethod.CASH ||
      data.paymentMethod === PaymentMethod.BACKEND;

    const startAt = paymentDone ? new Date() : null;
    const endAt =
      paymentDone && startAt
        ? new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000)
        : null;

    const subscription = await PackageCourseSubscription.create({
      customerId: userId,
      courseId: data.courseId || plan.courseId || null,
      packageId: plan._id, // pricing plan link (schema stores PackageCourseEbookPrice id here)
      customerShippingId: data.shippingId || null,
      trackingId: null,
      startAt,
      endAt,
      status: paymentDone,
      promocodeId: priceResolution.promocodeId,
      promoterId: priceResolution.promoterId,
      referrerId: priceResolution.referrerId,
      paidAmount: finalPrice,
      customerPercentage: priceResolution.customerPercentage,
      promoterPercentage: 0,
    });

    if (paymentDone && priceResolution.referrerId) {
      await creditReferrer({
        referrerId: priceResolution.referrerId,
        buyerId: userId,
        orderId: subscription._id as Types.ObjectId,
        paidAmount: finalPrice,
        source: data.courseId ? "course" : "package",
      });
    }

    logger.info("placeCourseOrder success", { traceId, customerId: userId, orderId: subscription._id, amount: finalPrice, paymentDone });
    return res.status(201).json({
      success: true,
      data: {
        orderId: subscription._id,
        amount: finalPrice,
        basePrice: plan.price,
        currency: "INR",
        paymentMethod: data.paymentMethod,
        requiresPayment: !paymentDone,
        subscription,
      },
    });
  } catch (error: any) {
    if (error.issues) { logger.warn("placeCourseOrder validation failed", { traceId, customerId: userId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("placeCourseOrder failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/orders/ebook
export const placeEbookOrder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info("placeEbookOrder invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("placeEbookOrder unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const data = placeEbookOrderSchema.parse(req.body);

    const plan = await EbookPrice.findById(data.planId);
    if (!plan || !plan.status || String(plan.ebookId) !== data.ebookId) { logger.warn("placeEbookOrder plan not found", { traceId, customerId: userId, planId: data.planId, ebookId: data.ebookId }); return res.status(404).json({ success: false, message: "Plan not found for this ebook." }); }

    // Ebooks are not part of the new `appliesTo` enum — promocodes no longer
    // discount ebooks. Referral codes still apply through their own branch.
    const priceResolution = await resolveFinalPrice({
      basePrice: plan.price,
      cart: null,
      promocodeRaw: data.promocode,
      userId,
    });
    const { finalPrice } = priceResolution;

    const isFree = finalPrice === 0 || data.paymentMethod === PaymentMethod.FREE;
    const paymentDone =
      isFree ||
      data.paymentMethod === PaymentMethod.BANK ||
      data.paymentMethod === PaymentMethod.CASH ||
      data.paymentMethod === PaymentMethod.BACKEND;

    const order = await EbookOrder.create({
      customerId: userId,
      ebookId: data.ebookId,
      planId: data.planId,
      paymentMethod: data.paymentMethod,
      orderPrice: finalPrice,
      razorpayOrderId: data.razorpayOrderId || null,
      razorpayPaymentId: data.razorpayPaymentId || null,
      status: paymentDone
        ? PackageCourseEbookOrderStatus.COMPLETE
        : PackageCourseEbookOrderStatus.PENDING,
    });

    let subscription = null;
    if (paymentDone) {
      const startAt = new Date();
      const endAt = new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);
      subscription = await EbookSubscription.create({
        orderId: order._id,
        customerId: userId,
        ebookId: data.ebookId,
        price: finalPrice,
        startAt,
        endAt,
        paymentType:
          data.paymentMethod === PaymentMethod.BACKEND
            ? PackageCourseEbookPaymentType.BACKEND
            : PackageCourseEbookPaymentType.ONLINE,
        status: true,
        promocodeId: priceResolution.promocodeId,
        promoterId: priceResolution.promoterId,
        referrerId: priceResolution.referrerId,
      });

      if (priceResolution.referrerId) {
        await creditReferrer({
          referrerId: priceResolution.referrerId,
          buyerId: userId,
          orderId: order._id as Types.ObjectId,
          paidAmount: finalPrice,
          source: "ebook",
        });
      }
    }

    logger.info("placeEbookOrder success", { traceId, customerId: userId, orderId: order._id, amount: finalPrice, paymentDone });
    return res.status(201).json({
      success: true,
      data: {
        orderId: order._id,
        amount: finalPrice,
        basePrice: plan.price,
        currency: "INR",
        paymentMethod: data.paymentMethod,
        requiresPayment: !paymentDone,
        subscription,
      },
    });
  } catch (error: any) {
    if (error.issues) { logger.warn("placeEbookOrder validation failed", { traceId, customerId: userId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("placeEbookOrder failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/orders/verify-payment
export const verifyPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info("verifyPayment invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("verifyPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const data = verifyPaymentSchema.parse(req.body);

    if (data.orderType === "ebook") {
      const order = await EbookOrder.findOne({ _id: data.orderId, customerId: userId });
      if (!order) { logger.warn("verifyPayment ebook order not found", { traceId, customerId: userId, orderId: data.orderId }); return res.status(404).json({ success: false, message: "Order not found." }); }

      order.razorpayOrderId = data.razorpayOrderId;
      order.razorpayPaymentId = data.razorpayPaymentId;
      order.status = PackageCourseEbookOrderStatus.COMPLETE;
      await order.save();

      const plan = await EbookPrice.findById(order.planId);
      if (!plan) { logger.warn("verifyPayment ebook plan missing", { traceId, customerId: userId, orderId: data.orderId, planId: order.planId }); return res.status(404).json({ success: false, message: "Plan missing." }); }
      const startAt = new Date();
      const endAt = new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);

      // Reuse referrerId stamped on an existing subscription row if the order
      // was placed via the `placeEbookOrder` path that already persisted one.
      const existingSub = await EbookSubscription.findOne({ orderId: order._id }).lean();
      const referrerId = existingSub?.referrerId ?? null;

      const sub =
        existingSub ??
        (await EbookSubscription.create({
          orderId: order._id,
          customerId: userId,
          ebookId: order.ebookId,
          price: order.orderPrice,
          startAt,
          endAt,
          paymentType: PackageCourseEbookPaymentType.ONLINE,
          status: true,
          referrerId,
        }));

      if (referrerId) {
        await creditReferrer({
          referrerId,
          buyerId: userId,
          orderId: order._id as Types.ObjectId,
          paidAmount: order.orderPrice,
          source: "ebook",
        });
      }

      logger.info("verifyPayment ebook success", { traceId, customerId: userId, orderId: data.orderId, subscriptionId: sub._id });
      return res.status(200).json({ success: true, data: { order, subscription: sub } });
    }

    if (data.orderType === "course") {
      const sub = await PackageCourseSubscription.findOne({
        _id: data.orderId,
        customerId: userId,
      });
      if (!sub) { logger.warn("verifyPayment course order not found", { traceId, customerId: userId, orderId: data.orderId }); return res.status(404).json({ success: false, message: "Order not found." }); }

      const plan = await PackageCourseEbookPrice.findById(sub.packageId);
      if (!plan) { logger.warn("verifyPayment course plan missing", { traceId, customerId: userId, orderId: data.orderId, planId: sub.packageId }); return res.status(404).json({ success: false, message: "Plan missing." }); }

      const startAt = sub.startAt || new Date();
      const endAt = new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);
      sub.startAt = startAt;
      sub.endAt = endAt;
      sub.status = true;
      await sub.save();

      if (sub.referrerId) {
        await creditReferrer({
          referrerId: sub.referrerId,
          buyerId: userId,
          orderId: sub._id as Types.ObjectId,
          paidAmount: sub.paidAmount ?? 0,
          source: sub.courseId ? "course" : "package",
        });
      }

      logger.info("verifyPayment course success", { traceId, customerId: userId, subscriptionId: sub._id });
      return res.status(200).json({ success: true, data: { subscription: sub } });
    }

    if (data.orderType === "book") {
      const order = await BookOrder.findOne({ _id: data.orderId, customerId: userId });
      if (!order) { logger.warn("verifyPayment book order not found", { traceId, customerId: userId, orderId: data.orderId }); return res.status(404).json({ success: false, message: "Order not found." }); }
      order.razorpayOrderId = data.razorpayOrderId;
      order.razorpayPaymentId = data.razorpayPaymentId;
      order.status = "verified" as any;
      order.paidAt = new Date();
      await order.save();
      logger.info("verifyPayment book success", { traceId, customerId: userId, orderId: order._id });
      return res.status(200).json({ success: true, data: order });
    }

    logger.warn("verifyPayment unknown orderType", { traceId, customerId: userId, orderType: data.orderType });
    return res.status(400).json({ success: false, message: "Unknown order type." });
  } catch (error: any) {
    if (error.issues) { logger.warn("verifyPayment validation failed", { traceId, customerId: userId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("verifyPayment failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/orders — unified listing
export const listMyOrders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info("listMyOrders invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMyOrders unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const [courseSubs, ebookSubs, bookOrders] = await Promise.all([
      PackageCourseSubscription.find({ customerId: userId })
        .populate({ path: "courseId", model: Course, select: "name thumbnail" })
        .populate({ path: "packageId", model: PackageCourseEbookPrice })
        .sort({ createdAt: -1 })
        .lean(),
      EbookSubscription.find({ customerId: userId })
        .populate({ path: "ebookId", model: Ebook, select: "name thumbnail author" })
        .sort({ createdAt: -1 })
        .lean(),
      BookOrder.find({ customerId: userId })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    logger.info("listMyOrders success", { traceId, customerId: userId, courseSubs: courseSubs.length, ebookSubs: ebookSubs.length, bookOrders: bookOrders.length });
    return res.status(200).json({
      success: true,
      data: {
        courseSubscriptions: courseSubs,
        ebookSubscriptions: ebookSubs,
        bookOrders,
      },
    });
  } catch (error: any) {
    logger.error("listMyOrders failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
