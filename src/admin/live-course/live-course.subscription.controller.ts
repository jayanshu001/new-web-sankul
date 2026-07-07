import { Request, Response } from "express";
import { z } from "zod";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

// SQL grant: numeric ids (the Mongo schema enforces ObjectId).
const grantSqlSchema = z.object({
  customerId:     z.coerce.string().min(1),
  planId:         z.coerce.string().min(1),
  durationDays:   z.number().int().positive().optional(),
  durationMonths: z.number().int().positive().optional(),
  startAt:        z.string().trim().optional(),
  endAt:          z.string().trim().optional(),
}).strict();

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
    const r = await liveSql.listSubscriptions({
      liveCourseId: req.params.id ? String(req.params.id) : (q.liveCourseId ? String(q.liveCourseId) : undefined),
      customerId: q.customerId ? String(q.customerId) : undefined,
      status: q.status,
      paymentMethod: q.paymentMethod,
      dateFrom: q.dateFrom ?? q.fromDate,
      dateTo: q.dateTo ?? q.toDate,
      search: q.search,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      page, limit,
    });
    if (r === "bad_course") return failure(res, "Invalid live course id.", 422);
    if (r === "bad_customer") return failure(res, "Invalid customer id.", 422);
    return res.status(200).json({ success: true, summary: r.summary, data: r.data, pagination: r.pagination });
  } catch (err) {
    logger.error("listLiveCourseSubscriptions failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list subscriptions.", 500);
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
    const r = await liveSql.grantSubscription(cid, v);
    if (!r.ok) {
      const code = r.code === "course" || r.code === "customer" || r.code === "plan" ? 404 : 422;
      return failure(res, r.msg, code);
    }
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
    const r = await liveSql.updateSubscription(sid, v);
    if (r === "not_found") return failure(res, "Subscription not found.", 404);
    if (r === "bad_start") return failure(res, "startAt must be a valid date.", 422);
    if (r === "bad_end") return failure(res, "endAt must be a valid date.", 422);
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
    if (!(await liveSql.deleteSubscription(sid))) return failure(res, "Subscription not found.", 404);
    return success(res, { id }, "Subscription deleted.");
  } catch (err) {
    logger.error("deleteLiveCourseSubscription failed", { traceId, subscriptionId: id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete subscription.", 500);
  }
};
