import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Customer } from "../../models/customer/Customer.model";
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  createEbookSubscriptionSchema,
} from "./subscription.validation";
import { PackageCourseEbookOrderStatus } from "../../models/enums";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

const paginated = (req: Request) => {
  const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
  const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// ─── Course/Package subscriptions ──────────────────────────────────────────────

export const listCourseSubscriptions = async (req: Request, res: Response) => {
  try {
    const { customerId, courseId, packageId, status, fromDate, toDate } =
      req.query as Record<string, string>;

    const filter: any = {};
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (courseId && isObjectId(courseId)) filter.courseId = courseId;
    if (packageId && isObjectId(packageId)) filter.packageId = packageId;
    if (status === "true" || status === "false") filter.status = status === "true";
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const { pageNum, limitNum, skip } = paginated(req);

    const [data, total] = await Promise.all([
      PackageCourseSubscription.find(filter)
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber emailAddress" })
        .populate({ path: "courseId", model: Course, select: "name thumbnail" })
        .populate({ path: "packageId", model: PackageCourseEbookPrice })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      PackageCourseSubscription.countDocuments(filter),
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

export const getCourseSubscriptionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid subscription id." });

    const sub = await PackageCourseSubscription.findById(id)
      .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber emailAddress" })
      .populate({ path: "courseId", model: Course })
      .populate({ path: "packageId", model: PackageCourseEbookPrice });

    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found." });
    return res.status(200).json({ success: true, data: sub });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCourseSubscription = async (req: Request, res: Response) => {
  try {
    const data = createSubscriptionSchema.parse(req.body);
    const plan = await PackageCourseEbookPrice.findById(data.planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found." });

    const sub = await PackageCourseSubscription.create({
      customerId: data.customerId,
      courseId: data.courseId || plan.courseId || null,
      packageId: plan._id,
      customerShippingId: data.customerShippingId || null,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      status: true,
    });

    return res.status(201).json({ success: true, data: sub });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourseSubscription = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid subscription id." });

    const data = updateSubscriptionSchema.parse(req.body);
    const update: any = { ...data };
    if (data.startAt) update.startAt = new Date(data.startAt);
    if (data.endAt) update.endAt = new Date(data.endAt);

    const sub = await PackageCourseSubscription.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found." });
    return res.status(200).json({ success: true, data: sub });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCourseSubscription = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid subscription id." });
    const deleted = await PackageCourseSubscription.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Subscription not found." });
    return res.status(200).json({ success: true, message: "Subscription deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Ebook subscriptions (listing + create only — admin ebook-subscription.controller already has CRUD) ─

export const listEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const { customerId, ebookId, status, fromDate, toDate } = req.query as Record<string, string>;
    const filter: any = {};
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (ebookId && isObjectId(ebookId)) filter.ebookId = ebookId;
    if (status === "true" || status === "false") filter.status = status === "true";
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const { pageNum, limitNum, skip } = paginated(req);

    const [data, total] = await Promise.all([
      EbookSubscription.find(filter)
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .populate({ path: "ebookId", model: Ebook, select: "name author" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      EbookSubscription.countDocuments(filter),
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

// ─── Reports ──────────────────────────────────────────────────────────────────

const buildDateFilter = (fromDate?: string, toDate?: string) => {
  const f: any = {};
  if (fromDate) f.$gte = new Date(fromDate);
  if (toDate) f.$lte = new Date(toDate);
  return Object.keys(f).length ? { createdAt: f } : {};
};

// GET /subscriptions/reports/summary
export const reportSummary = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    const dateFilter = buildDateFilter(fromDate, toDate);

    const [
      totalCourseSubs,
      activeCourseSubs,
      totalEbookSubs,
      activeEbookSubs,
      ebookRevenueAgg,
      bookRevenueAgg,
      bookOrdersTotal,
    ] = await Promise.all([
      PackageCourseSubscription.countDocuments(dateFilter),
      PackageCourseSubscription.countDocuments({ ...dateFilter, status: true }),
      EbookSubscription.countDocuments(dateFilter),
      EbookSubscription.countDocuments({ ...dateFilter, status: true }),
      EbookOrder.aggregate([
        { $match: { status: PackageCourseEbookOrderStatus.COMPLETE, ...(Object.keys(dateFilter).length ? dateFilter : {}) } },
        { $group: { _id: null, revenue: { $sum: "$orderPrice" }, count: { $sum: 1 } } },
      ]),
      BookOrder.aggregate([
        { $match: { status: "verified", ...(Object.keys(dateFilter).length ? dateFilter : {}) } },
        { $group: { _id: null, revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      BookOrder.countDocuments(dateFilter),
    ]);

    const ebookRevenue = ebookRevenueAgg[0]?.revenue || 0;
    const bookRevenue = bookRevenueAgg[0]?.revenue || 0;

    return res.status(200).json({
      success: true,
      data: {
        courseSubscriptions: { total: totalCourseSubs, active: activeCourseSubs },
        ebookSubscriptions: {
          total: totalEbookSubs,
          active: activeEbookSubs,
          revenue: ebookRevenue,
          orderCount: ebookRevenueAgg[0]?.count || 0,
        },
        bookOrders: {
          total: bookOrdersTotal,
          verifiedCount: bookRevenueAgg[0]?.count || 0,
          revenue: bookRevenue,
        },
        totalRevenue: ebookRevenue + bookRevenue,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /subscriptions/reports/by-course
export const reportByCourse = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    const dateFilter = buildDateFilter(fromDate, toDate);

    const rows = await PackageCourseSubscription.aggregate([
      { $match: { courseId: { $ne: null }, ...(Object.keys(dateFilter).length ? dateFilter : {}) } },
      {
        $group: {
          _id: "$courseId",
          totalSubscriptions: { $sum: 1 },
          activeSubscriptions: { $sum: { $cond: ["$status", 1, 0] } },
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "_id",
          foreignField: "_id",
          as: "course",
        },
      },
      { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
      { $sort: { totalSubscriptions: -1 } },
    ]);

    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /subscriptions/reports/by-ebook
export const reportByEbook = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    const dateFilter = buildDateFilter(fromDate, toDate);

    const rows = await EbookSubscription.aggregate([
      { $match: { ...(Object.keys(dateFilter).length ? dateFilter : {}) } },
      {
        $group: {
          _id: "$ebookId",
          totalSubscriptions: { $sum: 1 },
          activeSubscriptions: { $sum: { $cond: ["$status", 1, 0] } },
          revenue: { $sum: "$price" },
        },
      },
      {
        $lookup: {
          from: "ws_ebooks",
          localField: "_id",
          foreignField: "_id",
          as: "ebook",
        },
      },
      { $unwind: { path: "$ebook", preserveNullAndEmptyArrays: true } },
      { $sort: { revenue: -1 } },
    ]);

    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /subscriptions/reports/book-orders
export const reportBookOrders = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, status } = req.query as Record<string, string>;
    const dateFilter = buildDateFilter(fromDate, toDate);
    const match: any = { ...(Object.keys(dateFilter).length ? dateFilter : {}) };
    if (status) match.status = status;

    const rows = await BookOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          revenue: { $sum: "$amount" },
        },
      },
    ]);

    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
