import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

// Admin grant: every field but the date overrides comes from the plan. A grant
// lands as a fully verified, zero-cost subscription.
const grantSchema = z
  .object({
    customerId:     objectId,
    planId:         objectId,
    // Optional overrides. endAt wins over durationMonths wins over plan.duration.
    durationMonths: z.number().int().positive().optional(),
    startAt:        z.string().trim().optional(),
    endAt:          z.string().trim().optional(),
  })
  .strict();

const updateSubscriptionSchema = z
  .object({
    status:        z.boolean().optional(),
    paymentStatus: z.enum(["pending", "verified", "failed"]).optional(),
    startAt:       z.string().trim().optional(),
    endAt:         z.string().trim().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

const POPULATE_CUSTOMER = "firstName middleName lastName phoneNumber emailAddress";

// GET /api/v1/admin/live-courses/subscriptions
// GET /api/v1/admin/live-courses/:id/subscriptions   (:id → liveCourseId filter)
// Filters: customerId, liveCourseId, planId, paymentStatus, status, page, limit.
export const listLiveCourseSubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveCourseSubscriptions invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);

    // :id is present on the /:id/subscriptions route; otherwise read the query.
    const liveCourseId = String(req.params.id ?? req.query.liveCourseId ?? "");
    const customerId = String(req.query.customerId ?? "");
    const planId = String(req.query.planId ?? "");
    const paymentStatus = req.query.paymentStatus;
    const statusFilter = req.query.status;

    const query: Record<string, any> = {};
    if (liveCourseId) {
      if (!mongoose.Types.ObjectId.isValid(liveCourseId)) {
        return failure(res, "Invalid live course id.", 422);
      }
      query.liveCourseId = liveCourseId;
    }
    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return failure(res, "Invalid customer id.", 422);
      }
      query.customerId = customerId;
    }
    if (planId && mongoose.Types.ObjectId.isValid(planId)) query.planId = planId;
    if (paymentStatus === "pending" || paymentStatus === "verified" || paymentStatus === "failed") {
      query.paymentStatus = paymentStatus;
    }
    if (statusFilter === "true" || statusFilter === "false") {
      query.status = statusFilter === "true";
    }

    const [rows, total] = await Promise.all([
      LiveCourseSubscription.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("customerId", POPULATE_CUSTOMER)
        .populate("liveCourseId", "name image")
        .populate("planId", "name duration price")
        .lean(),
      LiveCourseSubscription.countDocuments(query),
    ]);

    logger.info("listLiveCourseSubscriptions success", { traceId, total, returned: rows.length });
    return success(res, { subscriptions: rows, total, page, limit }, "Subscriptions fetched.");
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getLiveCourseSubscription invalid id", { traceId, subscriptionId: id });
      return failure(res, "Invalid subscription id.", 422);
    }

    const sub = await LiveCourseSubscription.findById(id)
      .populate("customerId", POPULATE_CUSTOMER)
      .populate("liveCourseId", "name image")
      .populate("planId", "name duration price")
      .lean();
    if (!sub) {
      logger.warn("getLiveCourseSubscription not found", { traceId, subscriptionId: id });
      return failure(res, "Subscription not found.", 404);
    }

    logger.info("getLiveCourseSubscription success", { traceId, subscriptionId: id });
    return success(res, { subscription: sub }, "Subscription fetched.");
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
    if (!mongoose.Types.ObjectId.isValid(liveCourseId)) {
      logger.warn("grantLiveCourseSubscription invalid id", { traceId, liveCourseId });
      return failure(res, "Invalid live course id.", 422);
    }

    let validated: z.infer<typeof grantSchema>;
    try {
      validated = grantSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn("grantLiveCourseSubscription validation failed", { traceId, liveCourseId, issues: err.issues });
        return zodIssueResponse(res, err);
      }
      throw err;
    }

    const [course, customer, plan] = await Promise.all([
      LiveCourse.findById(liveCourseId).select("_id name").lean(),
      Customer.findById(validated.customerId)
        .select("_id status isAccountDeleted")
        .lean(),
      LiveCoursePlan.findById(validated.planId)
        .select("_id liveCourseId duration")
        .lean(),
    ]);
    if (!course) { logger.warn("grantLiveCourseSubscription course not found", { traceId, liveCourseId }); return failure(res, "Live course not found.", 404); }
    if (!customer) { logger.warn("grantLiveCourseSubscription customer not found", { traceId, customerId: validated.customerId }); return failure(res, "Customer not found.", 404); }
    if (customer.isAccountDeleted) { logger.warn("grantLiveCourseSubscription customer deleted", { traceId, customerId: validated.customerId }); return failure(res, "Customer account is deleted.", 422); }
    if (!plan) { logger.warn("grantLiveCourseSubscription plan not found", { traceId, planId: validated.planId }); return failure(res, "Plan not found.", 404); }
    if (String(plan.liveCourseId) !== liveCourseId) {
      logger.warn("grantLiveCourseSubscription plan mismatch", { traceId, liveCourseId, planId: validated.planId });
      return failure(res, "Plan does not belong to this live course.", 422);
    }

    const now = new Date();

    let startAt = now;
    if (validated.startAt) {
      const d = new Date(validated.startAt);
      if (isNaN(d.getTime())) { logger.warn("grantLiveCourseSubscription invalid startAt", { traceId, startAt: validated.startAt }); return failure(res, "startAt must be a valid date.", 422); }
      startAt = d;
    }

    let endAt: Date;
    if (validated.endAt) {
      const d = new Date(validated.endAt);
      if (isNaN(d.getTime())) { logger.warn("grantLiveCourseSubscription invalid endAt", { traceId, endAt: validated.endAt }); return failure(res, "endAt must be a valid date.", 422); }
      endAt = d;
    } else {
      // `duration` is stored as MONTHS — delegate to shared helper that honours
      // calendar-month length via setMonth (matches webhook/verify/subscription).
      const months = validated.durationMonths ?? plan.duration;
      endAt = computeEndAt({ startAt, durationMonths: months });
    }
    if (endAt.getTime() <= startAt.getTime()) {
      logger.warn("grantLiveCourseSubscription endAt before startAt", { traceId, startAt, endAt });
      return failure(res, "endAt must be after startAt.", 422);
    }

    // Upsert-extend: rather than stacking a second row on top of an existing
    // active subscription (which surfaces as duplicate "My Subscription" cards
    // with differing availability), extend the existing row's endAt in place.
    // We extend only when the caller didn't pin an explicit start/end window —
    // an explicit override means "set this exact window", which we honour.
    const existing =
      validated.startAt || validated.endAt
        ? null
        : await LiveCourseSubscription.findOne({
            customerId: validated.customerId,
            liveCourseId,
            status: true,
            paymentStatus: "verified",
            $or: [{ endAt: null }, { endAt: { $gte: now } }],
          }).sort({ endAt: -1 });

    if (existing) {
      // Stack the plan's duration onto whatever time is left on the row.
      const months = validated.durationMonths ?? plan.duration;
      existing.endAt = extendEndAt({ currentEndAt: existing.endAt, durationMonths: months, now });
      existing.planId = validated.planId as any;
      existing.paidAt = now;
      await existing.save();

      logger.info("grantLiveCourseSubscription extended existing", {
        traceId,
        subscriptionId: existing._id,
        customerId: validated.customerId,
        liveCourseId,
        endAt: existing.endAt?.toISOString?.(),
        by: req.user?.id,
      });

      return success(res, { subscription: existing.toObject() }, "Subscription extended.");
    }

    const sub = await LiveCourseSubscription.create({
      customerId: validated.customerId,
      liveCourseId,
      planId: validated.planId,
      startAt,
      endAt,
      status: true,
      paidAmount: 0,
      paymentStatus: "verified",
      paidAt: now,
    });

    logger.info("grantLiveCourseSubscription success", {
      traceId,
      subscriptionId: sub._id,
      customerId: validated.customerId,
      liveCourseId,
      by: req.user?.id,
    });

    return success(res, { subscription: sub.toObject() }, "Subscription granted.", 201);
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("updateLiveCourseSubscription invalid id", { traceId, subscriptionId: id });
      return failure(res, "Invalid subscription id.", 422);
    }

    let validated: z.infer<typeof updateSubscriptionSchema>;
    try {
      validated = updateSubscriptionSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn("updateLiveCourseSubscription validation failed", { traceId, subscriptionId: id, issues: err.issues });
        return zodIssueResponse(res, err);
      }
      throw err;
    }

    const update: Record<string, any> = {};
    if (validated.status !== undefined) update.status = validated.status;
    if (validated.paymentStatus !== undefined) update.paymentStatus = validated.paymentStatus;
    if (validated.startAt !== undefined) {
      const d = new Date(validated.startAt);
      if (isNaN(d.getTime())) { logger.warn("updateLiveCourseSubscription invalid startAt", { traceId, subscriptionId: id }); return failure(res, "startAt must be a valid date.", 422); }
      update.startAt = d;
    }
    if (validated.endAt !== undefined) {
      const d = new Date(validated.endAt);
      if (isNaN(d.getTime())) { logger.warn("updateLiveCourseSubscription invalid endAt", { traceId, subscriptionId: id }); return failure(res, "endAt must be a valid date.", 422); }
      update.endAt = d;
    }

    const sub = await LiveCourseSubscription.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!sub) {
      logger.warn("updateLiveCourseSubscription not found", { traceId, subscriptionId: id });
      return failure(res, "Subscription not found.", 404);
    }

    logger.info("updateLiveCourseSubscription success", {
      traceId,
      subscriptionId: id,
      fields: Object.keys(update),
      by: req.user?.id,
    });

    return success(res, { subscription: sub.toObject() }, "Subscription updated.");
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("deleteLiveCourseSubscription invalid id", { traceId, subscriptionId: id });
      return failure(res, "Invalid subscription id.", 422);
    }

    const out = await LiveCourseSubscription.findByIdAndDelete(id);
    if (!out) {
      logger.warn("deleteLiveCourseSubscription not found", { traceId, subscriptionId: id });
      return failure(res, "Subscription not found.", 404);
    }

    logger.info("deleteLiveCourseSubscription success", { traceId, subscriptionId: id, by: req.user?.id });
    return success(res, { id }, "Subscription deleted.");
  } catch (err) {
    logger.error("deleteLiveCourseSubscription failed", { traceId, subscriptionId: id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete subscription.", 500);
  }
};
