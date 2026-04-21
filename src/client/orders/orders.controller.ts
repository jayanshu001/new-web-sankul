import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
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

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

interface PriceResolution {
  finalPrice: number;
  promocodeId: Types.ObjectId | null;
  promoterId: Types.ObjectId | null;
  customerPercentage: number | null;
  promoterPercentage: number | null;
}

async function resolveFinalPrice(opts: {
  basePrice: number;
  planId: string;
  promocodeRaw?: string;
  userId?: string;
}): Promise<PriceResolution> {
  const { basePrice, planId, promocodeRaw, userId } = opts;
  const empty: PriceResolution = {
    finalPrice: basePrice,
    promocodeId: null,
    promoterId: null,
    customerPercentage: null,
    promoterPercentage: null,
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
    }).lean(),
    Customer.findOne({ referralCode: code, isAccountDeleted: false, status: true }).lean(),
    ReferralProgram.findOne({ name: "student", status: true }).lean(),
  ]);

  if (promo) {
    const promoted = await PromotedPackageCourseEbook.findOne({
      promocodeId: promo._id,
      planId,
    }).lean();
    if (promoted) {
      const discount = Math.round((basePrice * promoted.customerPercentage) / 100);
      return {
        finalPrice: Math.max(0, basePrice - discount),
        promocodeId: promo._id as Types.ObjectId,
        promoterId: (promo.promoterId ?? null) as Types.ObjectId | null,
        customerPercentage: promoted.customerPercentage,
        promoterPercentage: promoted.promoterPercentage,
      };
    }
    return empty;
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
        customerPercentage: referralProgram.referralDiscount,
      };
    }
  }

  return empty;
}

// POST /api/v1/client/orders/course
export const placeCourseOrder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = placeCourseOrderSchema.parse(req.body);

    const plan = await PackageCourseEbookPrice.findById(data.planId);
    if (!plan || !plan.status)
      return res.status(404).json({ success: false, message: "Plan not found." });

    if (data.courseId && String(plan.courseId) !== data.courseId)
      return res.status(400).json({ success: false, message: "Plan does not belong to this course." });
    if (data.packageId && String(plan.packageId) !== data.packageId)
      return res.status(400).json({ success: false, message: "Plan does not belong to this package." });

    const priceResolution = await resolveFinalPrice({
      basePrice: plan.price,
      planId: data.planId,
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
      paidAmount: finalPrice,
      customerPercentage: priceResolution.customerPercentage,
      promoterPercentage: priceResolution.promoterPercentage,
    });

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
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/orders/ebook
export const placeEbookOrder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = placeEbookOrderSchema.parse(req.body);

    const plan = await EbookPrice.findById(data.planId);
    if (!plan || !plan.status || String(plan.ebookId) !== data.ebookId)
      return res.status(404).json({ success: false, message: "Plan not found for this ebook." });

    // For ebook, check promocode via PackageCourseEbookPrice mirror if present — otherwise treat as no discount
    const mirrored = await PackageCourseEbookPrice.findOne({ ebookId: data.ebookId, duration: plan.duration })
      .select("_id")
      .lean();
    const priceResolution = await resolveFinalPrice({
      basePrice: plan.price,
      planId: mirrored ? String(mirrored._id) : data.planId,
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
      });
    }

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
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/orders/verify-payment
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = verifyPaymentSchema.parse(req.body);

    if (data.orderType === "ebook") {
      const order = await EbookOrder.findOne({ _id: data.orderId, customerId: userId });
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });

      order.razorpayOrderId = data.razorpayOrderId;
      order.razorpayPaymentId = data.razorpayPaymentId;
      order.status = PackageCourseEbookOrderStatus.COMPLETE;
      await order.save();

      const plan = await EbookPrice.findById(order.planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan missing." });
      const startAt = new Date();
      const endAt = new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);

      const sub = await EbookSubscription.create({
        orderId: order._id,
        customerId: userId,
        ebookId: order.ebookId,
        price: order.orderPrice,
        startAt,
        endAt,
        paymentType: PackageCourseEbookPaymentType.ONLINE,
        status: true,
      });

      return res.status(200).json({ success: true, data: { order, subscription: sub } });
    }

    if (data.orderType === "course") {
      const sub = await PackageCourseSubscription.findOne({
        _id: data.orderId,
        customerId: userId,
      });
      if (!sub) return res.status(404).json({ success: false, message: "Order not found." });

      const plan = await PackageCourseEbookPrice.findById(sub.packageId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan missing." });

      const startAt = sub.startAt || new Date();
      const endAt = new Date(startAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);
      sub.startAt = startAt;
      sub.endAt = endAt;
      sub.status = true;
      await sub.save();

      return res.status(200).json({ success: true, data: { subscription: sub } });
    }

    if (data.orderType === "book") {
      const order = await BookOrder.findOne({ _id: data.orderId, customerId: userId });
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });
      order.razorpayOrderId = data.razorpayOrderId;
      order.razorpayPaymentId = data.razorpayPaymentId;
      order.status = "verified" as any;
      order.paidAt = new Date();
      await order.save();
      return res.status(200).json({ success: true, data: order });
    }

    return res.status(400).json({ success: false, message: "Unknown order type." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/orders — unified listing
export const listMyOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

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

    return res.status(200).json({
      success: true,
      data: {
        courseSubscriptions: courseSubs,
        ebookSubscriptions: ebookSubs,
        bookOrders,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
