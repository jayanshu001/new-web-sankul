import { Request, Response } from "express";
import { z } from "zod";
import { success, failure, failureFrom, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";
import { flushUserRouteCache } from "../../middlewares/autoFlush";
import { PaymentMethod } from "../../shared/enums";
import { assertReportStatus } from "../../utils/reportFilters";

// SQL grant: numeric ids (the Mongo schema enforces ObjectId). Extended from the
// original free-grant to a full paid grant via the standardized payment section:
// method + amount + reference ids persist inline on ws_live_course_subscription
// (this table has no sibling order table). Ref ids arrive only for their method.
const grantSqlSchema = z.object({
  customerId:        z.coerce.string().min(1),
  // Optional: without a plan the grant is priced by `amount` and its window is
  // driven by durationDays/durationMonths/endAt (one of which is then required).
  planId:            z.coerce.string().min(1).optional(),
  durationDays:      z.number().int().positive().optional(),
  durationMonths:    z.number().int().positive().optional(),
  startAt:           z.string().trim().optional(),
  endAt:             z.string().trim().optional(),
  amount:            z.number().nonnegative().optional(),
  withMaterial:      z.boolean().optional(),
  customerShippingId: z.coerce.string().min(1).optional().nullable(),
  remarks:           z.string().max(1000).optional().nullable(),
  paymentMethod:     z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
  bankTransactionId: z.string().optional().nullable(),
  razorpayOrderId:   z.string().optional().nullable(),
  razorpayPaymentId: z.string().optional().nullable(),
  // Subscription Type = Extend: top up the existing sub instead of a fresh row.
  extend:            z.boolean().optional(),
}).strict().refine(
  (v) => !!(v.planId || v.durationDays || v.durationMonths || v.endAt),
  { message: "Provide planId or a window (durationDays/durationMonths/endAt).", path: ["planId"] },
);

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

const updateSubscriptionSchema = z
  .object({
    status:        z.boolean().optional(),
    paymentStatus: z.enum(["pending", "verified", "failed"]).optional(),
    startAt:       z.string().trim().optional(),
    endAt:         z.string().trim().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

// Shared filter mapping for the report list + its CSV/Excel exports, so all three
// honor an identical param contract (docs/backend-requests/live-course-report-
// detailed-export.md). `:id` (when present) pins the liveCourseId filter.
export const buildSubReportQuery = (q: Record<string, string>, paramsId?: string | string[]): liveSql.SubReportQuery => ({
  liveCourseId: paramsId ? String(paramsId) : (q.liveCourseId ? String(q.liveCourseId) : undefined),
  customerId: q.customerId ? String(q.customerId) : undefined,
  // 422s an unrecognised status instead of silently returning an unfiltered list.
  status: assertReportStatus(q.status),
  paymentMethod: q.paymentMethod,
  activationType: q.activationType,
  // Date range bounds `createdAt` at IST day edges — `createdFrom`/`createdTo` is the
  // unified cross-report name (reports-date-filter-created-at.md); dateFrom/dateTo +
  // fromDate/toDate kept as legacy aliases.
  dateFrom: q.createdFrom ?? q.dateFrom ?? q.fromDate,
  dateTo: q.createdTo ?? q.dateTo ?? q.toDate,
  startFrom: q.startFrom,
  endTo: q.endTo,
  search: q.search,
  sortBy: q.sortBy,
  sortOrder: q.sortOrder,
});

// GET /api/v1/admin/live-courses/subscriptions
// GET /api/v1/admin/live-courses/:id/subscriptions   (:id → liveCourseId filter)
// Reports contract (docs/REPORTS_SUBSCRIPTIONS_ADMIN.md): filters customerId,
// liveCourseId, status (active|expired|inactive), paymentMethod (online|backend),
// search (customer name/phone/email), dateFrom/dateTo, sortBy/sortOrder, page/limit.
// Envelope is hand-rolled { success, summary, data, pagination } (siblings — NOT
// nested under success()'s `data`), matching the course/package report endpoint.
export const listLiveCourseSubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveCourseSubscriptions invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
    const r = await liveSql.listSubscriptions({ ...buildSubReportQuery(q, req.params.id), page, limit });
    if (r === "bad_course") return failure(res, "Invalid live course id.", 422);
    if (r === "bad_customer") return failure(res, "Invalid customer id.", 422);
    return res.status(200).json({ success: true, summary: r.summary, data: r.data, pagination: r.pagination });
  } catch (err) {
    logger.error("listLiveCourseSubscriptions failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failureFrom(res, err, "Failed to list subscriptions.");
  }
};

// GET /api/v1/admin/live-courses/subscriptions/export/csv — full filtered set, no pagination.
export const exportLiveCourseSubscriptionsCsv = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("exportLiveCourseSubscriptionsCsv invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const r = await liveSql.buildSubscriptionsCsv(buildSubReportQuery(req.query as Record<string, string>, req.params.id));
    if (r === "bad_course") return failure(res, "Invalid live course id.", 422);
    if (r === "bad_customer") return failure(res, "Invalid customer id.", 422);
    const filename = `live-course-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(r);
  } catch (err) {
    logger.error("exportLiveCourseSubscriptionsCsv failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failureFrom(res, err, "Failed to export subscriptions.");
  }
};

// GET /api/v1/admin/live-courses/subscriptions/export/excel — full filtered set, no pagination.
export const exportLiveCourseSubscriptionsExcel = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("exportLiveCourseSubscriptionsExcel invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const r = await liveSql.buildSubscriptionsXlsx(buildSubReportQuery(req.query as Record<string, string>, req.params.id));
    if (r === "bad_course") return failure(res, "Invalid live course id.", 422);
    if (r === "bad_customer") return failure(res, "Invalid customer id.", 422);
    const filename = `live-course-subscriptions-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(r);
  } catch (err) {
    logger.error("exportLiveCourseSubscriptionsExcel failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failureFrom(res, err, "Failed to export subscriptions.");
  }
};

// GET /api/v1/admin/live-courses/subscriptions/:subscriptionId
export const getLiveCourseSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId ?? "");
  logger.info("getLiveCourseSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    const sid = liveSql.parseLiveId(id);
    if (!sid) return failure(res, "Invalid subscription id.", 422);
    const r = await liveSql.getSubscription(sid);
    if (r === "not_found") return failure(res, "Subscription not found.", 404);
    return success(res, { subscription: r }, "Subscription fetched.");
  } catch (err) {
    logger.error("getLiveCourseSubscription failed", { traceId, subscriptionId: id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch subscription.", 500);
  }
};

// POST /api/v1/admin/live-courses/:id/grant
// The "free-grant" flow: hand a customer an active, verified subscription with
// no payment. Window comes from the plan unless overridden.
export const grantLiveCourseSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.id ?? "");
  logger.info("grantLiveCourseSubscription invoked", { traceId, path: req.originalUrl, liveCourseId, userId: req.user?.id });

  try {
    const cid = liveSql.parseLiveId(liveCourseId);
    if (!cid) return failure(res, "Invalid live course id.", 422);
    let v: z.infer<typeof grantSqlSchema>;
    try { v = grantSqlSchema.parse(req.body); } catch (err) { if (err instanceof z.ZodError) return zodIssueResponse(res, err); throw err; }
    // Audit: acting admin from the JWT (never from the body).
    const actingAdminId = liveSql.parseLiveId(String(req.user?.id ?? "")) ?? null;
    const r = await liveSql.grantSubscription(cid, { ...v, actingAdminId });
    if (!r.ok) {
      const code = r.code === "course" || r.code === "customer" || r.code === "plan" ? 404 : 422;
      return failure(res, r.msg, code);
    }
    // Admin granted live-course access → clear that customer's cached catalog reads.
    await flushUserRouteCache(v.customerId);
    return success(res, { subscription: r.data }, r.created ? "Subscription granted." : "Subscription extended.", r.created ? 201 : 200);
  } catch (err) {
    logger.error("grantLiveCourseSubscription failed", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to grant subscription.", 500);
  }
};

// PUT /api/v1/admin/live-courses/subscriptions/:subscriptionId
// Extend (endAt), revoke (status:false), or correct payment state.
export const updateLiveCourseSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId ?? "");
  logger.info("updateLiveCourseSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    const sid = liveSql.parseLiveId(id);
    if (!sid) return failure(res, "Invalid subscription id.", 422);
    let v: z.infer<typeof updateSubscriptionSchema>;
    try { v = updateSubscriptionSchema.parse(req.body); } catch (err) { if (err instanceof z.ZodError) return zodIssueResponse(res, err); throw err; }
    // Audit: acting admin from the JWT stamps updated_by.
    const actingAdminId = liveSql.parseLiveId(String(req.user?.id ?? "")) ?? null;
    // Revoking here (status:false) is the documented way to cut a customer's access,
    // so resolve the owner before mutating and drop their cached catalog reads after.
    const customerId = await liveSql.getSubscriptionCustomerId(sid);
    const r = await liveSql.updateSubscription(sid, { ...v, actingAdminId });
    if (r === "not_found") return failure(res, "Subscription not found.", 404);
    if (r === "bad_start") return failure(res, "startAt must be a valid date.", 422);
    if (r === "bad_end") return failure(res, "endAt must be a valid date.", 422);
    // Without this, live listings/detail keep returning subscribed:true for up to
    // 24h (per-user route cache TTL).
    if (customerId) await flushUserRouteCache(customerId);
    return success(res, { subscription: r }, "Subscription updated.");
  } catch (err) {
    logger.error("updateLiveCourseSubscription failed", { traceId, subscriptionId: id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update subscription.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/subscriptions/:subscriptionId
// Hard delete — for cleaning up test/erroneous rows. To revoke a real
// customer's access prefer PUT { status: false }, which keeps the audit trail.
export const deleteLiveCourseSubscription = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.subscriptionId ?? "");
  logger.info("deleteLiveCourseSubscription invoked", { traceId, path: req.originalUrl, subscriptionId: id, userId: req.user?.id });

  try {
    const sid = liveSql.parseLiveId(id);
    if (!sid) return failure(res, "Invalid subscription id.", 422);
    // Resolve the owner BEFORE deleting — the row is gone afterwards.
    const customerId = await liveSql.getSubscriptionCustomerId(sid);
    if (!(await liveSql.deleteSubscription(sid))) return failure(res, "Subscription not found.", 404);
    if (customerId) await flushUserRouteCache(customerId);
    return success(res, { id }, "Subscription deleted.");
  } catch (err) {
    logger.error("deleteLiveCourseSubscription failed", { traceId, subscriptionId: id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete subscription.", 500);
  }
};
