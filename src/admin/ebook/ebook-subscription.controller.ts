// Admin ebook subscriptions: HTTP handlers for report, exports and manual grants.
import { Request, Response } from "express";
import { createEbookSubscriptionSqlSchema, updateEbookSubscriptionSchema } from "./ebook.validation";
import * as adminEbook from "../../modules/admin-ebook/admin-ebook.service";
import { flushUserRouteCache } from "../../middlewares/autoFlush";
import { success, failure } from "../../utils/httpResponse";
import { parseEbookSubReportQuery } from "../../modules/report-query/report-query";

export const getEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(q.page || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(q.limit || "20", 10) || 20, 1);

    const parsed = parseEbookSubReportQuery(q);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });

    const { items, total } = await adminEbook.listSubscriptions({
      ...parsed.query,
      page: pageNum,
      limit: limitNum,
    });
    return res.status(200).json({
      success: true,
      items,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Entire filtered set, no pagination.
export const exportEbookSubscriptionsCsv = async (req: Request, res: Response) => {
  try {
    const parsed = parseEbookSubReportQuery(req.query as Record<string, string>);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
    const csv = await adminEbook.buildSubscriptionsCsv(parsed.query);
    const filename = `ebook-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Entire filtered set, no pagination.
export const exportEbookSubscriptionsExcel = async (req: Request, res: Response) => {
  try {
    const parsed = parseEbookSubReportQuery(req.query as Record<string, string>);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
    const buf = await adminEbook.buildSubscriptionsXlsx(parsed.query);
    const filename = `ebook-subscriptions-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buf);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookSubscriptionById = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    const data = await adminEbook.getSubscriptionById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Subscription not found" });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Manual admin grant (or extend); flushes the customer's cached isPurchased.
export const createEbookSubscription = async (req: Request, res: Response) => {
  try {
    const d = createEbookSubscriptionSqlSchema.parse(req.body);
    const result = await adminEbook.createSubscription({
      customerId: d.customerId,
      ebookId: d.ebookId,
      planId: d.planId ?? null,
      durationInDays: d.durationInDays,
      paymentMethod: d.paymentMethod,
      orderPrice: d.orderPrice ?? 0,
      razorpayOrderId: d.razorpayOrderId ?? null,
      razorpayPaymentId: d.razorpayPaymentId ?? null,
      transactionId: d.transactionId ?? null,
      ipAddress: req.ip ?? null,
      remarks: d.remarks ?? null,
      status: d.status,
      extend: d.extend,
      // From the JWT, never the body.
      actingAdminId: adminEbook.parseEbookId(String(req.user?.id ?? "")) ?? null,
    });
    if (!result.ok) {
      const msg = result.reason === "ebook" ? "Ebook not found" : "Plan not found";
      return res.status(404).json({ success: false, message: msg });
    }
    await flushUserRouteCache(d.customerId);
    return res.status(201).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Verify a pending order or toggle/re-date the subscription; flushes the owner's cache.
export const updateEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;

    const validatedData = updateEbookSubscriptionSchema.parse(req.body);

    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    // Revoking changes isPurchased across the catalog; resolve the owner for the flush below.
    const customerId = await adminEbook.getSubscriptionCustomerId(numId);
    const result = await adminEbook.updateSubscription(numId, {
      razorpayOrderId: validatedData.razorpayOrderId,
      razorpayPaymentId: validatedData.razorpayPaymentId,
      remarks: validatedData.remarks,
      status: validatedData.status,
      startAt: validatedData.startAt,
      endAt: validatedData.endAt,
      // From the JWT; stamps updated_by.
      actingAdminId: adminEbook.parseEbookId(String(req.user?.id ?? "")) ?? null,
    });
    if (result === "not_found") return res.status(404).json({ success: false, message: "Subscription not found" });
    if (result === "order_not_found") return res.status(404).json({ success: false, message: "Order not found" });
    if (result === "already_active") return res.status(400).json({ success: false, message: "Subscription is already active" });
    if (result === "bad_start") return res.status(400).json({ success: false, message: "startAt must be a valid date" });
    if (result === "bad_end") return res.status(400).json({ success: false, message: "endAt must be a valid date" });
    // Otherwise cached reads report the old isPurchased for up to 24h.
    if (customerId) await flushUserRouteCache(customerId);
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addEbookSubscriptionDays = async (req: Request, res: Response) => {
  try {
    const input = req.body as { days: number; remark?: string };
    const actingAdminId = adminEbook.parseEbookId(String(req.user?.id ?? "")) ?? null;
    const result = await adminEbook.addSubscriptionDays(Number(req.params.subscriptionId), { ...input, actingAdminId });
    if (!result) return failure(res, "Subscription not found.", 404);
    if (result.customerId) await flushUserRouteCache(result.customerId);
    return success(res, { subscription: result.subscription }, "Days added.");
  } catch (error) {
    return failure(res, (error as Error).message, 500);
  }
};

export const deleteEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    // Resolve the owner before the row is deleted.
    const customerId = await adminEbook.getSubscriptionCustomerId(numId);
    const ok = await adminEbook.deleteSubscription(numId);
    if (!ok) return res.status(404).json({ success: false, message: "Subscription not found" });
    if (customerId) await flushUserRouteCache(customerId);
    return res.status(200).json({ success: true, message: "Subscription deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Plan options for the Add-Subscription form.
export const getEbookPricesForSubscription = async (req: Request, res: Response) => {
  try {
    const ebookId = req.params.ebookId as string;
    const numId = adminEbook.parseEbookId(ebookId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    const res2 = await adminEbook.getEbookPricesForSubscription(numId);
    // A missing ebook returns [] (no 404) by contract.

    return res.status(200).json({ success: true, data: res2 === "not_found" ? [] : res2 });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
