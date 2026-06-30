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
// Filters: customerId, liveCourseId, planId, paymentStatus, status, page, limit.
export const listLiveCourseSubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveCourseSubscriptions invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const r = await liveSql.listSubscriptions({
      liveCourseId: req.params.id ? String(req.params.id) : (req.query.liveCourseId ? String(req.query.liveCourseId) : undefined),
      customerId: req.query.customerId ? String(req.query.customerId) : undefined,
      planId: req.query.planId ? String(req.query.planId) : undefined,
      paymentStatus: req.query.paymentStatus as string | undefined,
      status: req.query.status as string | undefined,
      page: req.query.page as string | undefined,
      limit: req.query.limit as string | undefined,
    });
    if (r === "bad_course") return failure(res, "Invalid live course id.", 422);
    if (r === "bad_customer") return failure(res, "Invalid customer id.", 422);
    return success(res, r, "Subscriptions fetched.");
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
