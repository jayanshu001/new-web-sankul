import { Request, Response } from "express";
import { createEbookSubscriptionSqlSchema, updateEbookSubscriptionSchema } from "./ebook.validation";
import * as adminEbook from "../../modules/admin-ebook/admin-ebook.service";
import { isReportStatus, REPORT_STATUSES } from "../../utils/reportFilters";
import { flushUserRouteCache } from "../../middlewares/autoFlush";

// Shared filter mapping for the report list + its CSV/Excel exports, so all three
// honor the identical param contract. Returns a 400 message on invalid ids/method.
export const parseSubReportQuery = (
  q: Record<string, string>,
): { ok: false; message: string } | { ok: true; query: adminEbook.SubReportQuery } => {
  if (q.customerId && !adminEbook.parseEbookId(q.customerId)) return { ok: false, message: "Invalid customerId" };
  if (q.ebookId && !adminEbook.parseEbookId(q.ebookId)) return { ok: false, message: "Invalid ebookId" };
  const paymentMethodEnum = adminEbook.coercePaymentMethod(q.paymentMethod);
  if (q.paymentMethod && !paymentMethodEnum) return { ok: false, message: "Invalid paymentMethod" };
  // Computed report status (active|expired|inactive); legacy true/false still accepted.
  // Anything else is rejected rather than dropped: an unrecognised value (e.g. the
  // upper-case "ACTIVE" the admin UI used to send) would otherwise fall through BOTH
  // `statusFilter` and the legacy boolean below as undefined, returning a plausible
  // but silently UNFILTERED list. This mirrors assertReportStatus in reportFilters;
  // that helper isn't reused here only because this report also honors true/false.
  if (q.status && !isReportStatus(q.status) && q.status !== "true" && q.status !== "false")
    return {
      ok: false,
      message: `Invalid status "${q.status}". Allowed: ${REPORT_STATUSES.join(", ")} (lower-case).`,
    };
  const statusFilter = isReportStatus(q.status) ? q.status : undefined;
  return {
    ok: true,
    query: {
      customerId: q.customerId ? adminEbook.parseEbookId(q.customerId)! : undefined,
      ebookId: q.ebookId ? adminEbook.parseEbookId(q.ebookId)! : undefined,
      status: q.status === "true" ? true : q.status === "false" ? false : undefined,
      statusFilter,
      paymentMethod: paymentMethodEnum,
      // Date range bounds `createdAt` at IST day edges — `createdFrom`/`createdTo` is
      // the unified cross-report name (reports-date-filter-created-at.md); dateFrom/
      // dateTo kept as legacy aliases.
      dateFrom: adminEbook.parseDateBound(q.createdFrom ?? q.dateFrom, false),
      dateTo: adminEbook.parseDateBound(q.createdTo ?? q.dateTo, true),
      search: q.search,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    },
  };
};

export const getEbookSubscriptions = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(q.page || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(q.limit || "20", 10) || 20, 1);

    const parsed = parseSubReportQuery(q);
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

// GET /admin/ebooks/subscriptions/export/csv — entire filtered set, no pagination.
export const exportEbookSubscriptionsCsv = async (req: Request, res: Response) => {
  try {
    const parsed = parseSubReportQuery(req.query as Record<string, string>);
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

// GET /admin/ebooks/subscriptions/export/excel — entire filtered set, no pagination.
export const exportEbookSubscriptionsExcel = async (req: Request, res: Response) => {
  try {
    const parsed = parseSubReportQuery(req.query as Record<string, string>);
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

export const createEbookSubscription = async (req: Request, res: Response) => {
  try {
    const d = createEbookSubscriptionSqlSchema.parse(req.body);
    const result = await adminEbook.createSubscription({
      customerId: d.customerId,
      ebookId: d.ebookId,
      planId: d.planId ?? null,
      durationInDays: d.durationInDays,
      paymentMethod: d.paymentMethod,
      orderPrice: d.orderPrice ?? 0, // guaranteed present by schema refine (amount|orderPrice)
      razorpayOrderId: d.razorpayOrderId ?? null,
      razorpayPaymentId: d.razorpayPaymentId ?? null,
      transactionId: d.transactionId ?? null,
      ipAddress: req.ip ?? null,
      remarks: d.remarks ?? null,
      status: d.status,
      extend: d.extend,
      // Audit: acting admin from the JWT (never from the body).
      actingAdminId: adminEbook.parseEbookId(String(req.user?.id ?? "")) ?? null,
    });
    if (!result.ok) {
      const msg = result.reason === "ebook" ? "Ebook not found" : "Plan not found";
      return res.status(404).json({ success: false, message: msg });
    }
    // Admin granted an ebook → clear that customer's cached catalog reads.
    await flushUserRouteCache(d.customerId);
    return res.status(201).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;

    const validatedData = updateEbookSubscriptionSchema.parse(req.body);

    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    // Revoke path (status:false) changes isPurchased across the catalog; resolve the
    // owner before mutating so the flush below mirrors the delete handler.
    const customerId = await adminEbook.getSubscriptionCustomerId(numId);
    const result = await adminEbook.updateSubscription(numId, {
      razorpayOrderId: validatedData.razorpayOrderId,
      razorpayPaymentId: validatedData.razorpayPaymentId,
      remarks: validatedData.remarks,
      status: validatedData.status,
      startAt: validatedData.startAt,
      endAt: validatedData.endAt,
      // Audit: acting admin from the JWT stamps updated_by.
      actingAdminId: adminEbook.parseEbookId(String(req.user?.id ?? "")) ?? null,
    });
    if (result === "not_found") return res.status(404).json({ success: false, message: "Subscription not found" });
    if (result === "order_not_found") return res.status(404).json({ success: false, message: "Order not found" });
    if (result === "already_active") return res.status(400).json({ success: false, message: "Subscription is already active" });
    if (result === "bad_start") return res.status(400).json({ success: false, message: "startAt must be a valid date" });
    if (result === "bad_end") return res.status(400).json({ success: false, message: "endAt must be a valid date" });
    // Drop the owner's cached per-user reads so ebook listings/details stop
    // reporting isPurchased:true immediately (24h TTL otherwise).
    if (customerId) await flushUserRouteCache(customerId);
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEbookSubscription = async (req: Request, res: Response) => {
  try {
    const subscriptionId = req.params.subscriptionId as string;
    const numId = adminEbook.parseEbookId(subscriptionId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid subscription ID" });
    // Resolve the owner BEFORE deleting — the row is gone afterwards.
    const customerId = await adminEbook.getSubscriptionCustomerId(numId);
    const ok = await adminEbook.deleteSubscription(numId);
    if (!ok) return res.status(404).json({ success: false, message: "Subscription not found" });
    if (customerId) await flushUserRouteCache(customerId);
    return res.status(200).json({ success: true, message: "Subscription deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookPricesForSubscription = async (req: Request, res: Response) => {
  try {
    const ebookId = req.params.ebookId as string;
    const numId = adminEbook.parseEbookId(ebookId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    const res2 = await adminEbook.getEbookPricesForSubscription(numId);
    // Mongo returns [] for a missing ebook (no 404) — keep that contract.
    return res.status(200).json({ success: true, data: res2 === "not_found" ? [] : res2 });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
