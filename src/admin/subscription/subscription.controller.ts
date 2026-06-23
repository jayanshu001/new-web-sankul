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
  adminUpdateAddressSchema,
} from "./subscription.validation";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { PackageCourseEbookOrderStatus, PaymentMethod } from "../../models/enums";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import * as subSql from "../../modules/admin-subscription/admin-subscription.service";
import {
  listAddresses as sqlListAddresses,
  createAddress as sqlCreateAddress,
  updateAddress as sqlUpdateAddress,
  deleteAddress as sqlDeleteAddress,
  parseAddressId,
} from "../../modules/customer-address/customer-address.service";
import type { AddressCreateInput, AddressUpdateInput } from "../../modules/customer-address/customer-address.types";
import { getCustomer as sqlGetCustomer } from "../../modules/admin-customer/admin-customer.service";
import { resolveCityName } from "../../modules/offline-city/offline-city.service";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

const paginated = (req: Request) => {
  const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
  const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// ─── Course/Package subscriptions ──────────────────────────────────────────────

export const listCourseSubscriptions = async (req: Request, res: Response) => {
  try {
    const { customerId, courseId, packageId, status, fromDate, toDate, search, sortBy, sortOrder, type } =
      req.query as Record<string, string>;

    if (subSql.isAdminSubscriptionMysql()) {
      const { pageNum, limitNum } = paginated(req);
      const { items, pagination } = await subSql.listCourseSubscriptions({
        customerId, courseId, packageId, status, fromDate, toDate, search, sortBy, sortOrder, type, page: pageNum, limit: limitNum,
      });
      return res.status(200).json({ success: true, items, pagination });
    }

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

    if (type === "course") filter.courseId = { ...(filter.courseId || {}), $ne: null };
    else if (type === "package") {
      filter.courseId = null;
      filter.targetPackageId = { $ne: null };
    }

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const [matchedCustomers, matchedCourses, matchedPackages, matchedPlans] = await Promise.all([
        Customer.find({ $or: [{ firstName: rx }, { lastName: rx }, { phoneNumber: rx }] }).select("_id").lean(),
        Course.find({ name: rx }).select("_id").lean(),
        Package.find({ name: rx }).select("_id").lean(),
        PackageCourseEbookPrice.find({ name: rx }).select("_id").lean(),
      ]);
      filter.$or = [
        { customerId: { $in: matchedCustomers.map((c) => c._id) } },
        { courseId: { $in: matchedCourses.map((c) => c._id) } },
        { targetPackageId: { $in: matchedPackages.map((p) => p._id) } },
        { packageId: { $in: matchedPlans.map((p) => p._id) } },
      ];
    }

    const { pageNum, limitNum, skip } = paginated(req);

    const sortField = sortBy || "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [rows, total] = await Promise.all([
      PackageCourseSubscription.find(filter)
        .populate({ path: "customerId", model: Customer, select: "_id firstName lastName phoneNumber" })
        .populate({ path: "courseId", model: Course, select: "_id name image thumbnail" })
        .populate({ path: "targetPackageId", model: Package, select: "_id name image thumbnail" })
        .populate({ path: "packageId", model: PackageCourseEbookPrice, select: "_id name duration price" })
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PackageCourseSubscription.countDocuments(filter),
    ]);

    const items = rows.map((r: any) => ({
      _id: r._id,
      customerId: r.customerId,
      courseId: r.courseId || null,
      targetPackageId: r.targetPackageId || null,
      planId: r.packageId || null,
      paidAmount: r.paidAmount ?? 0,
      startAt: r.startAt,
      endAt: r.endAt,
      paymentMethod: r.paymentMethod ?? null,
      paymentStatus: r.paymentStatus ?? null,
      status: r.status,
      withMaterial: r.withMaterial ?? false,
      remark: r.remark ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      items,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseSubscriptionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (subSql.isAdminSubscriptionMysql()) {
      const numId = subSql.parseSubId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription id." });
      const data = await subSql.getCourseSubscriptionById(numId);
      if (data === "not_found") return res.status(404).json({ success: false, message: "Subscription not found." });
      return res.status(200).json({ success: true, data });
    }
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

// ⚠ STAY Mongo (no SQL branch): createCourseSubscription / updateCourseSubscription /
// deleteCourseSubscription + listCustomerAddresses / adminCreateCustomerAddress.
// The subscription writes set Mongo-only fields (paymentStatus/paidAmount/
// paymentMethod/withMaterial/remark/targetPackageId) with grant-extend logic;
// ws_package_course_subscription lacks those columns. The address handlers touch
// CustomerAddress (held OFF — offline-city dep). Only the read/report surface is
// on SQL (admin-subscription module, Wave 7). Revisit writes with the payment wave.
// Gateway methods map to the SQL 2-value `payment_type` enum; everything else
// (admin/offline grants — backend/bank/cash/free) is treated as "backend".
const ONLINE_METHODS: string[] = [PaymentMethod.RAZORPAY, PaymentMethod.PAYKUN, PaymentMethod.PAYTM];

export const createCourseSubscription = async (req: Request, res: Response) => {
  try {
    const data = createSubscriptionSchema.parse(req.body);

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (subSql.isAdminSubscriptionMysql()) {
      const customerId = subSql.parseSubId(String(data.customerId));
      if (!customerId) return res.status(400).json({ success: false, message: "Invalid customerId." });
      const planId = subSql.parseSubId(String(data.planId));
      if (!planId) return res.status(400).json({ success: false, message: "Invalid planId." });
      if (!(await sqlGetCustomer(customerId)))
        return res.status(404).json({ success: false, message: "Customer not found." });

      const r = await subSql.createCourseSubscription({
        customerId,
        courseId: data.courseId ? subSql.parseSubId(String(data.courseId)) ?? undefined : undefined,
        packageId: data.packageId ? subSql.parseSubId(String(data.packageId)) ?? undefined : undefined,
        planId,
        withMaterial: !!data.withMaterial,
        paymentType: ONLINE_METHODS.includes(data.paymentMethod) ? "online" : "backend",
        amount: data.amount,
        durationDays: data.durationDays,
        startAt: data.startAt,
        customerShippingId: data.customerShippingId ? subSql.parseSubId(String(data.customerShippingId)) ?? null : null,
        remark: data.remark,
        status: data.status,
      });
      if (!r.ok) {
        if (r.reason === "plan_not_found") return res.status(404).json({ success: false, message: "Plan not found." });
        if (r.reason === "course_mismatch") return res.status(400).json({ success: false, message: "Plan does not belong to the selected course." });
        if (r.reason === "package_mismatch") return res.status(400).json({ success: false, message: "Plan does not belong to the selected package." });
        return res.status(400).json({ success: false, message: "Shipping address (customerShippingId) is required when withMaterial is true." });
      }
      return res.status(r.extended ? 200 : 201).json({ success: true, data: r.data, ...(r.extended ? { extended: true } : {}) });
    }

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

    const now = new Date();
    const resolvedCourseId = data.courseId || plan.courseId || null;
    const resolvedPackageId = data.packageId || plan.packageId || null;

    // Compute amount: explicit > plan.price (+ materialPrice if withMaterial)
    const computedAmount =
      typeof data.amount === "number"
        ? data.amount
        : (plan.price || 0) + (data.withMaterial ? (plan as any).materialPrice || 0 : 0);

    // Upsert-extend: if the customer already has an active verified subscription
    // for this same course (or package) target, extend that row's endAt instead
    // of inserting a second row. Two rows for the same target are exactly what
    // surfaced as duplicate "My Subscription" cards with differing availability.
    // We only auto-extend when the caller did NOT pin an explicit startAt — an
    // explicit startAt signals "create a distinct window", so we honour it.
    const target: Record<string, any> = { customerId: data.customerId, status: true, paymentStatus: "verified" };
    if (resolvedCourseId) {
      target.courseId = resolvedCourseId;
    } else if (resolvedPackageId) {
      target.courseId = null;
      target.targetPackageId = resolvedPackageId;
    }
    const existing =
      !data.startAt && (resolvedCourseId || resolvedPackageId)
        ? await PackageCourseSubscription.findOne(target).sort({ endAt: -1 })
        : null;

    if (existing) {
      const newEndAt =
        data.durationDays && data.durationDays > 0
          ? extendEndAt({ currentEndAt: existing.endAt, durationMonths: data.durationDays, asDays: true, now })
          : extendEndAt({ currentEndAt: existing.endAt, durationMonths: plan.duration || 0, now });

      existing.endAt = newEndAt;
      existing.packageId = plan._id; // reflect the plan they extended with
      existing.paidAmount = (existing.paidAmount || 0) + computedAmount;
      if (data.customerShippingId) existing.customerShippingId = data.customerShippingId as any;
      if (data.withMaterial) existing.withMaterial = true;
      if (data.remark) existing.remark = data.remark;
      existing.paidAt = now;
      await existing.save();

      return res.status(200).json({ success: true, data: existing, extended: true });
    }

    // No active sub for this target — grant a fresh one. Delegate window math to
    // the shared helper so the setMonth-honors-calendar-length contract matches
    // the webhook/verify paths.
    const startAt = data.startAt ? new Date(data.startAt) : now;
    const endAt =
      data.durationDays && data.durationDays > 0
        ? computeEndAt({ startAt, durationMonths: data.durationDays, asDays: true })
        : computeEndAt({ startAt, durationMonths: plan.duration || 0 });

    const sub = await PackageCourseSubscription.create({
      customerId: data.customerId,
      courseId: resolvedCourseId,
      targetPackageId: resolvedPackageId,
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
      paidAt: now,
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
    if (subSql.isAdminSubscriptionMysql()) {
      const cId = courseId ? subSql.parseSubId(courseId) ?? undefined : undefined;
      const pId = packageId ? subSql.parseSubId(packageId) ?? undefined : undefined;
      if (!cId && !pId) return res.status(400).json({ success: false, message: "Provide courseId or packageId." });
      return res.status(200).json({ success: true, data: await subSql.listPlansForTarget(cId, pId) });
    }
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
    const cid = parseAddressId(customerId);
    if (!cid) return res.status(400).json({ success: false, message: "Invalid customerId." });

    const data = await sqlListAddresses(cid);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/subscriptions/customer-addresses
export const adminCreateCustomerAddress = async (req: Request, res: Response) => {
  try {
    const data = adminCreateAddressSchema.parse(req.body);
    const cid = parseAddressId(String(data.customerId));
    if (!cid) return res.status(400).json({ success: false, message: "Invalid customerId." });
    if (!(await sqlGetCustomer(cid)))
      return res.status(404).json({ success: false, message: "Customer not found." });

    const cityId = data.cityId != null && data.cityId !== "" ? Number(data.cityId) : null;
    const stateId = data.stateId != null && data.stateId !== "" ? Number(data.stateId) : null;
    // `ws_customer_address.city` is NOT NULL VARCHAR(20) — fill the freeform name
    // from the selected cityId (truncated to the column width).
    const cityName = cityId ? ((await resolveCityName(cityId))?.name ?? "").slice(0, 20) : "";

    const input: AddressCreateInput = {
      customerId: cid,
      name: data.name,
      phone: data.phone ?? null,
      alternatePhone: data.alternatePhone ?? null,
      email: data.email ?? null,
      address: data.address,
      address2: data.address2 ?? "",
      city: cityName,
      stateId,
      cityId,
      pincode: data.pincode,
      status: true,
    };
    const address = await sqlCreateAddress(input);
    return res.status(201).json({ success: true, data: address });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /admin/subscriptions/customer-addresses/:id
export const adminUpdateCustomerAddress = async (req: Request, res: Response) => {
  try {
    const data = adminUpdateAddressSchema.parse(req.body);
    const aid = parseAddressId(req.params.id as string);
    const cid = parseAddressId(String(data.customerId));
    if (!aid) return res.status(400).json({ success: false, message: "Invalid address id." });
    if (!cid) return res.status(400).json({ success: false, message: "Invalid customerId." });

    const input: AddressUpdateInput = {};
    if (data.name !== undefined) input.name = data.name;
    if (data.phone !== undefined) input.phone = data.phone;
    if (data.alternatePhone !== undefined) input.alternatePhone = data.alternatePhone;
    if (data.email !== undefined) input.email = data.email;
    if (data.address !== undefined) input.address = data.address;
    if (data.address2 !== undefined) input.address2 = data.address2;
    if (data.stateId !== undefined) input.stateId = data.stateId != null && data.stateId !== "" ? Number(data.stateId) : null;
    if (data.label !== undefined) input.label = data.label;
    if (data.status !== undefined) input.status = data.status;
    if (data.cityId !== undefined) {
      const cityId = data.cityId != null && data.cityId !== "" ? Number(data.cityId) : null;
      input.cityId = cityId;
      // Keep the NOT-NULL `city` name column in sync with the selected city.
      input.city = cityId ? ((await resolveCityName(cityId))?.name ?? "").slice(0, 20) : "";
    }

    const r = await sqlUpdateAddress(aid, cid, input);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /admin/subscriptions/customer-addresses/:id?customerId=...
export const adminDeleteCustomerAddress = async (req: Request, res: Response) => {
  try {
    const aid = parseAddressId(req.params.id as string);
    const cid = parseAddressId(String(req.query.customerId ?? ""));
    if (!aid) return res.status(400).json({ success: false, message: "Invalid address id." });
    if (!cid) return res.status(400).json({ success: false, message: "Invalid customerId." });
    const r = await sqlDeleteAddress(aid, cid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "Address deleted." });
  } catch (error: any) {
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
    if (subSql.isAdminSubscriptionMysql()) {
      const { pageNum, limitNum } = paginated(req);
      const { data, pagination } = await subSql.listEbookSubscriptions({ customerId, ebookId, status, fromDate, toDate, page: pageNum, limit: limitNum });
      return res.status(200).json({ success: true, data, pagination });
    }
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
    if (subSql.isAdminSubscriptionMysql()) {
      return res.status(200).json({ success: true, data: await subSql.reportSummary(fromDate, toDate) });
    }
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
    if (subSql.isAdminSubscriptionMysql()) {
      return res.status(200).json({ success: true, data: await subSql.reportByCourse(fromDate, toDate) });
    }
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
    if (subSql.isAdminSubscriptionMysql()) {
      return res.status(200).json({ success: true, data: await subSql.reportByEbook(fromDate, toDate) });
    }
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
    if (subSql.isAdminSubscriptionMysql()) {
      return res.status(200).json({ success: true, data: await subSql.reportBookOrders(fromDate, toDate, status) });
    }
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
