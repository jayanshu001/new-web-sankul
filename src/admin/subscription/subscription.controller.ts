import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  createEbookSubscriptionSchema,
  adminCreateAddressSchema,
  adminUpdateAddressSchema,
} from "./subscription.validation";
import { PaymentMethod } from "../../models/enums";
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

    const { pageNum, limitNum } = paginated(req);
    const { items, pagination } = await subSql.listCourseSubscriptions({
      customerId, courseId, packageId, status, fromDate, toDate, search, sortBy, sortOrder, type, page: pageNum, limit: limitNum,
    });
    return res.status(200).json({ success: true, items, pagination });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseSubscriptionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = subSql.parseSubId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription id." });
    const data = await subSql.getCourseSubscriptionById(numId);
    if (data === "not_found") return res.status(404).json({ success: false, message: "Subscription not found." });
    return res.status(200).json({ success: true, data });
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
    const cId = courseId ? subSql.parseSubId(courseId) ?? undefined : undefined;
    const pId = packageId ? subSql.parseSubId(packageId) ?? undefined : undefined;
    if (!cId && !pId) return res.status(400).json({ success: false, message: "Provide courseId or packageId." });
    return res.status(200).json({ success: true, data: await subSql.listPlansForTarget(cId, pId) });
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
    const { pageNum, limitNum } = paginated(req);
    const { data, pagination } = await subSql.listEbookSubscriptions({ customerId, ebookId, status, fromDate, toDate, page: pageNum, limit: limitNum });
    return res.status(200).json({ success: true, data, pagination });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Reports ──────────────────────────────────────────────────────────────────

// GET /subscriptions/reports/summary
export const reportSummary = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    return res.status(200).json({ success: true, data: await subSql.reportSummary(fromDate, toDate) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /subscriptions/reports/by-course
export const reportByCourse = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    return res.status(200).json({ success: true, data: await subSql.reportByCourse(fromDate, toDate) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /subscriptions/reports/by-ebook
export const reportByEbook = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    return res.status(200).json({ success: true, data: await subSql.reportByEbook(fromDate, toDate) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /subscriptions/reports/book-orders
export const reportBookOrders = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, status } = req.query as Record<string, string>;
    return res.status(200).json({ success: true, data: await subSql.reportBookOrders(fromDate, toDate, status) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
