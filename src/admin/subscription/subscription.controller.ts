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
  adminCreateAddressSchema,
} from "./subscription.validation";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
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

    // Validate customer exists
    const customer = await Customer.findById(data.customerId).select("_id");
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });

    // Validate plan and ensure it matches the chosen course/package
    const plan = await PackageCourseEbookPrice.findById(data.planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found." });

    if (data.courseId && String(plan.courseId || "") !== String(data.courseId)) {
      return res.status(400).json({ success: false, message: "Plan does not belong to the selected course." });
    }
    if (data.packageId && String(plan.packageId || "") !== String(data.packageId)) {
      return res.status(400).json({ success: false, message: "Plan does not belong to the selected package." });
    }

    // Validate shipping address if material is requested
    if (data.withMaterial && !data.customerShippingId) {
      return res.status(400).json({
        success: false,
        message: "Shipping address (customerShippingId) is required when withMaterial is true.",
      });
    }
    if (data.customerShippingId) {
      const addr = await CustomerAddress.findOne({
        _id: data.customerShippingId,
        customerId: data.customerId,
      }).select("_id");
      if (!addr) {
        return res.status(400).json({
          success: false,
          message: "Address does not belong to the selected customer.",
        });
      }
    }

    // Compute startAt / endAt
    const startAt = data.startAt ? new Date(data.startAt) : new Date();
    const endAt = new Date(startAt);
    if (data.durationDays && data.durationDays > 0) {
      endAt.setDate(endAt.getDate() + data.durationDays);
    } else {
      // Plan `duration` is months per project convention.
      endAt.setMonth(endAt.getMonth() + (plan.duration || 0));
    }

    // Compute amount: explicit > plan.price (+ materialPrice if withMaterial)
    const computedAmount =
      typeof data.amount === "number"
        ? data.amount
        : (plan.price || 0) + (data.withMaterial ? (plan as any).materialPrice || 0 : 0);

    const sub = await PackageCourseSubscription.create({
      customerId: data.customerId,
      courseId: data.courseId || plan.courseId || null,
      targetPackageId: data.packageId || plan.packageId || null,
      packageId: plan._id, // plan row reference (historical field name)
      customerShippingId: data.customerShippingId || null,
      startAt,
      endAt,
      status: data.status ?? true,
      paidAmount: computedAmount,
      paymentStatus: "verified",
      paymentMethod: data.paymentMethod,
      withMaterial: !!data.withMaterial,
      remark: data.remark || null,
      paidAt: new Date(),
    });

    return res.status(201).json({ success: true, data: sub });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Helper endpoints for the Add-Subscription form ───────────────────────────

// GET /admin/subscriptions/plans?courseId=...&packageId=...
export const listPlansForTarget = async (req: Request, res: Response) => {
  try {
    const { courseId, packageId } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (courseId && isObjectId(courseId)) filter.courseId = courseId;
    else if (packageId && isObjectId(packageId)) filter.packageId = packageId;
    else
      return res
        .status(400)
        .json({ success: false, message: "Provide courseId or packageId." });

    const plans = await PackageCourseEbookPrice.find(filter).sort({ duration: 1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/subscriptions/customer-addresses/:customerId
export const listCustomerAddresses = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params as Record<string, string>;
    if (!isObjectId(customerId))
      return res.status(400).json({ success: false, message: "Invalid customerId." });

    const addresses = await CustomerAddress.find({ customerId, status: true })
      .populate("stateId", "_id name")
      .populate("cityId", "_id name")
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: addresses });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/subscriptions/customer-addresses
export const adminCreateCustomerAddress = async (req: Request, res: Response) => {
  try {
    const data = adminCreateAddressSchema.parse(req.body);
    const customer = await Customer.findById(data.customerId).select("_id");
    if (!customer)
      return res.status(404).json({ success: false, message: "Customer not found." });

    const address = await CustomerAddress.create({ ...data });
    return res.status(201).json({ success: true, data: address });
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
    if (data.remark !== undefined) update.remark = data.remark;

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
