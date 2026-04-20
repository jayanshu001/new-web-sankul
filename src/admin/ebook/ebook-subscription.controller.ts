import { Request, Response } from "express";
import mongoose from "mongoose";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { PackageCourseEbookOrderStatus, PackageCourseEbookPaymentType } from "../../models/enums";
import { createEbookSubscriptionSchema, updateEbookSubscriptionSchema } from "./ebook.validation";

export const getEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      ebookId,
      status,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filters: any = {};
    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ success: false, message: "Invalid customerId" });
      }
      filters.customerId = customerId;
    }
    if (ebookId) {
      if (!mongoose.Types.ObjectId.isValid(ebookId)) {
        return res.status(400).json({ success: false, message: "Invalid ebookId" });
      }
      filters.ebookId = ebookId;
    }
    if (status === "true" || status === "false") filters.status = status === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      EbookSubscription.find(filters)
        .populate("customerId", "_id full_name mobile email")
        .populate("ebookId", "_id name author")
        .populate("orderId", "_id paymentMethod orderPrice status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      EbookSubscription.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookSubscriptionById = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    }

    const subscription = await EbookSubscription.findById(subscriptionId)
      .populate("customerId", "_id full_name mobile email")
      .populate("ebookId", "_id name author")
      .populate("orderId");

    if (!subscription) {
      return res.status(404).json({ success: false, message: "Subscription not found" });
    }

    return res.status(200).json({ success: true, data: subscription });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createEbookSubscription = async (req: Request, res: Response) => {
  try {
    const validatedData = createEbookSubscriptionSchema.parse(req.body);
    const { customerId, ebookId, planId, durationInDays, paymentMethod, orderPrice, razorpayOrderId, razorpayPaymentId, transactionId, remarks, status } = validatedData;

    if (!mongoose.Types.ObjectId.isValid(customerId) || !mongoose.Types.ObjectId.isValid(ebookId)) {
      return res.status(400).json({ success: false, message: "Invalid customerId or ebookId" });
    }

    const ebookExists = await Ebook.exists({ _id: ebookId });
    if (!ebookExists) return res.status(404).json({ success: false, message: "Ebook not found" });

    let durationDays = durationInDays;
    let resolvedEbookId = ebookId;

    if (planId) {
      if (!mongoose.Types.ObjectId.isValid(planId)) {
        return res.status(400).json({ success: false, message: "Invalid planId" });
      }
      const plan = await EbookPrice.findById(planId);
      if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
      durationDays = plan.duration;
      resolvedEbookId = plan.ebookId.toString();
    }

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + (durationDays! * 24 * 60 * 60 * 1000));

    const session = await mongoose.startSession();
    session.startTransaction();
    let order: any;
    let subscription: any;
    try {
      order = new EbookOrder({
        customerId,
        ebookId: resolvedEbookId,
        planId: planId || null,
        paymentMethod,
        orderType: "purchase",
        orderPrice,
        razorpayOrderId: razorpayOrderId || null,
        razorpayPaymentId: razorpayPaymentId || null,
        ipAddress: req.ip || null,
        transactionId: transactionId || null,
        status: PackageCourseEbookOrderStatus.COMPLETE,
      });
      await order.save({ session });

      subscription = new EbookSubscription({
        orderId: order._id,
        customerId,
        ebookId: resolvedEbookId,
        price: orderPrice,
        startAt,
        endAt,
        remarks: remarks || null,
        paymentType: PackageCourseEbookPaymentType.BACKEND,
        status: status ?? true,
      });
      await subscription.save({ session });

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    return res.status(201).json({ success: true, data: { order, subscription } });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    }

    const validatedData = updateEbookSubscriptionSchema.parse(req.body);

    const subscription = await EbookSubscription.findById(subscriptionId);
    if (!subscription) return res.status(404).json({ success: false, message: "Subscription not found" });

    const order = await EbookOrder.findById(subscription.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.status === PackageCourseEbookOrderStatus.COMPLETE) {
      return res.status(400).json({ success: false, message: "Subscription is already active" });
    }

    order.razorpayOrderId = validatedData.razorpayOrderId ?? null;
    order.razorpayPaymentId = validatedData.razorpayPaymentId ?? null;
    order.status = PackageCourseEbookOrderStatus.COMPLETE;
    await order.save();

    if (validatedData.remarks !== undefined) {
      subscription.remarks = validatedData.remarks ?? null;
      await subscription.save();
    }

    return res.status(200).json({ success: true, data: { order, subscription } });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    }

    const subscription = await EbookSubscription.findByIdAndDelete(subscriptionId);
    if (!subscription) return res.status(404).json({ success: false, message: "Subscription not found" });

    return res.status(200).json({ success: true, message: "Subscription deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookPricesForSubscription = async (req: Request, res: Response) => {
  try {
    const ebookId = req.params.ebookId as string;
    if (!mongoose.Types.ObjectId.isValid(ebookId)) {
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    }

    const plans = await EbookPrice.find({ ebookId, status: true })
      .select("_id name price duration withMaterial materialPrice")
      .sort({ price: 1 });

    return res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
