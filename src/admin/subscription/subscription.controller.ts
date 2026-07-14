import { Request, Response } from "express";
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  createEbookSubscriptionSchema,
  adminCreateAddressSchema,
  adminUpdateAddressSchema,
} from "./subscription.validation";
import { PaymentMethod } from "../../shared/enums";
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

const paginated = (req: Request) => {
  const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
  const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// ─── Course/Package subscriptions ──────────────────────────────────────────────

// Shared filter mapping for the report list + its CSV/Excel exports, so all
// three honor the identical param contract. The date-range filter bounds
// `createdAt` (records created between X and Y) at IST day boundaries — accepted
// as `createdFrom`/`createdTo` (the unified cross-report name, see
// reports-date-filter-created-at.md) with `dateFrom`/`dateTo` + `fromDate`/`toDate`
// as legacy aliases. startFrom/startTo → startAt & endFrom/endTo → endAt remain
// supported for back-compat but the merged report's date boxes now use createdAt.
// activationType accepted, see service note.
export const reportQueryFrom = (q: Record<string, string>): subSql.CourseSubReportQuery => ({
  customerId: q.customerId, courseId: q.courseId, packageId: q.packageId, type: q.type,
  status: q.status, paymentMethod: q.paymentMethod,
  // tri-state: absent = no filter, "true" = with material, "false" = without.
  hasMaterial: q.hasMaterial === "true" ? true : q.hasMaterial === "false" ? false : undefined,
  // tri-state Ws Coin filter (order.ws_coin): "true" = redeemed (>0), "false" = not.
  hasWsCoin: q.hasWsCoin === "true" ? true : q.hasWsCoin === "false" ? false : undefined,
  // promoter / promocode filters + orderMethod (payment gateway, ≠ paymentMethod).
  promoterId: q.promoterId, promocodeId: q.promocodeId, orderMethod: q.orderMethod,
  dateFrom: q.createdFrom ?? q.dateFrom ?? q.fromDate, dateTo: q.createdTo ?? q.dateTo ?? q.toDate,
  startFrom: q.startFrom, startTo: q.startTo, endFrom: q.endFrom, endTo: q.endTo,
  activationType: q.activationType,
  search: q.search, sortBy: q.sortBy, sortOrder: q.sortOrder,
});

export const listCourseSubscriptions = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const { pageNum, limitNum } = paginated(req);
    const { summary, data, pagination } = await subSql.listCourseSubscriptions({
      ...reportQueryFrom(q), page: pageNum, limit: limitNum,
    });
    return res.status(200).json({ success: true, summary, data, pagination });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/subscriptions/export/csv — entire filtered set, no pagination.
export const exportCourseSubscriptionsCsv = async (req: Request, res: Response) => {
  try {
    const csv = await subSql.buildCourseSubscriptionsCsv(reportQueryFrom(req.query as Record<string, string>));
    const filename = `subscription-report-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/subscriptions/export/excel — entire filtered set, no pagination.
export const exportCourseSubscriptionsExcel = async (req: Request, res: Response) => {
  try {
    const buf = await subSql.buildCourseSubscriptionsXlsx(reportQueryFrom(req.query as Record<string, string>));
    const filename = `subscription-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buf);
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

// All subscription reads/writes now run on SQL (admin-subscription module).
// ws_package_course_subscription has no payment_status column, so paymentStatus
// is Mongo-only history (status conveys active). Gateway methods map to the SQL
// 2-value `payment_type` enum; everything else (admin/offline grants —
// backend/bank/cash/free) is treated as "backend".
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

    // Audit: derive the acting admin from the JWT (never from the body).
    const actingAdminId = subSql.parseSubId(String(req.user?.id ?? "")) ?? null;

    const r = await subSql.createCourseSubscription({
      customerId,
      courseId: data.courseId ? subSql.parseSubId(String(data.courseId)) ?? undefined : undefined,
      packageId: data.packageId ? subSql.parseSubId(String(data.packageId)) ?? undefined : undefined,
      planId,
      withMaterial: !!data.withMaterial,
      paymentType: ONLINE_METHODS.includes(data.paymentMethod) ? "online" : "backend",
      // Granular method + reference ids are persisted on the linked order row.
      paymentMethod: data.paymentMethod,
      bankTransactionId: data.bankTransactionId ?? null,
      razorpayOrderId: data.razorpayOrderId ?? null,
      razorpayPaymentId: data.razorpayPaymentId ?? null,
      amount: data.amount,
      durationDays: data.durationDays,
      startAt: data.startAt,
      customerShippingId: data.customerShippingId ? subSql.parseSubId(String(data.customerShippingId)) ?? null : null,
      remark: data.remark,
      status: data.status,
      extend: data.extend,
      actingAdminId,
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
    const numId = subSql.parseSubId(req.params.id as string);
    if (!numId)
      return res.status(400).json({ success: false, message: "Invalid subscription id." });

    const data = updateSubscriptionSchema.parse(req.body);
    // Only columns present on ws_package_course_subscription are patched; the
    // customerShippingId ObjectId string maps to the numeric `shipping` column.
    const shippingId =
      data.customerShippingId === undefined
        ? undefined
        : data.customerShippingId === null
        ? null
        : subSql.parseSubId(String(data.customerShippingId)) ?? null;

    const result = await subSql.updateCourseSubscription(numId, {
      startAt: data.startAt ? new Date(data.startAt) : undefined,
      endAt: data.endAt ? new Date(data.endAt) : undefined,
      status: data.status,
      shippingId,
      trackingId: data.trackingId === undefined ? undefined : data.trackingId === null ? null : BigInt(data.trackingId),
      remark: data.remark,
      // Audit: acting admin from the JWT stamps updated_by (created_by unchanged).
      actingAdminId: subSql.parseSubId(String(req.user?.id ?? "")) ?? null,
    });
    if (result === "not_found")
      return res.status(404).json({ success: false, message: "Subscription not found." });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCourseSubscription = async (req: Request, res: Response) => {
  try {
    const numId = subSql.parseSubId(req.params.id as string);
    if (!numId)
      return res.status(400).json({ success: false, message: "Invalid subscription id." });
    const deleted = await subSql.deleteCourseSubscription(numId);
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
