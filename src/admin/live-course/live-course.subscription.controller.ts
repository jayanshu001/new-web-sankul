import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

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

    return success(res, { subscriptions: rows, total, page, limit }, "Subscriptions fetched.");
  } catch (err) {
    logger.error("LiveCourseSubscription list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list subscriptions.", 500);
  }
};

// GET /api/v1/admin/live-courses/subscriptions/:subscriptionId
export const getLiveCourseSubscription = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subscriptionId ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid subscription id.", 422);
    }

    const sub = await LiveCourseSubscription.findById(id)
      .populate("customerId", POPULATE_CUSTOMER)
      .populate("liveCourseId", "name image")
      .populate("planId", "name duration price")
      .lean();
    if (!sub) return failure(res, "Subscription not found.", 404);

    return success(res, { subscription: sub }, "Subscription fetched.");
  } catch (err) {
    logger.error("LiveCourseSubscription get failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch subscription.", 500);
  }
};

// POST /api/v1/admin/live-courses/:id/grant
// The "free-grant" flow: hand a customer an active, verified subscription with
// no payment. Window comes from the plan unless overridden.
export const grantLiveCourseSubscription = async (req: Request, res: Response) => {
  try {
    const liveCourseId = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(liveCourseId)) {
      return failure(res, "Invalid live course id.", 422);
    }

    let validated: z.infer<typeof grantSchema>;
    try {
      validated = grantSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
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
    if (!course) return failure(res, "Live course not found.", 404);
    if (!customer) return failure(res, "Customer not found.", 404);
    if (customer.isAccountDeleted) return failure(res, "Customer account is deleted.", 422);
    if (!plan) return failure(res, "Plan not found.", 404);
    if (String(plan.liveCourseId) !== liveCourseId) {
      return failure(res, "Plan does not belong to this live course.", 422);
    }

    const now = new Date();

    let startAt = now;
    if (validated.startAt) {
      const d = new Date(validated.startAt);
      if (isNaN(d.getTime())) return failure(res, "startAt must be a valid date.", 422);
      startAt = d;
    }

    let endAt: Date;
    if (validated.endAt) {
      const d = new Date(validated.endAt);
      if (isNaN(d.getTime())) return failure(res, "endAt must be a valid date.", 422);
      endAt = d;
    } else {
      // `duration` is stored as MONTHS. setMonth honours calendar-month length.
      const months = validated.durationMonths ?? plan.duration;
      endAt = new Date(startAt);
      endAt.setMonth(endAt.getMonth() + months);
    }
    if (endAt.getTime() <= startAt.getTime()) {
      return failure(res, "endAt must be after startAt.", 422);
    }

    // Don't stack a grant on top of an already-active subscription — tell the
    // admin to extend the existing one instead.
    const existing = await LiveCourseSubscription.findOne({
      customerId: validated.customerId,
      liveCourseId,
      status: true,
      paymentStatus: "verified",
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    })
      .select("_id endAt")
      .lean();
    if (existing) {
      return failure(
        res,
        "Customer already has an active subscription to this live course. Use the update endpoint to extend it.",
        409,
        {},
        { subscriptionId: String(existing._id) }
      );
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

    logger.info("LiveCourseSubscription granted", {
      subscriptionId: sub._id,
      customerId: validated.customerId,
      liveCourseId,
      by: req.user?.id,
    });

    return success(res, { subscription: sub.toObject() }, "Subscription granted.", 201);
  } catch (err) {
    logger.error("LiveCourseSubscription grant failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to grant subscription.", 500);
  }
};

// PUT /api/v1/admin/live-courses/subscriptions/:subscriptionId
// Extend (endAt), revoke (status:false), or correct payment state.
export const updateLiveCourseSubscription = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subscriptionId ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid subscription id.", 422);
    }

    let validated: z.infer<typeof updateSubscriptionSchema>;
    try {
      validated = updateSubscriptionSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const update: Record<string, any> = {};
    if (validated.status !== undefined) update.status = validated.status;
    if (validated.paymentStatus !== undefined) update.paymentStatus = validated.paymentStatus;
    if (validated.startAt !== undefined) {
      const d = new Date(validated.startAt);
      if (isNaN(d.getTime())) return failure(res, "startAt must be a valid date.", 422);
      update.startAt = d;
    }
    if (validated.endAt !== undefined) {
      const d = new Date(validated.endAt);
      if (isNaN(d.getTime())) return failure(res, "endAt must be a valid date.", 422);
      update.endAt = d;
    }

    const sub = await LiveCourseSubscription.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!sub) return failure(res, "Subscription not found.", 404);

    logger.info("LiveCourseSubscription updated", {
      subscriptionId: id,
      fields: Object.keys(update),
      by: req.user?.id,
    });

    return success(res, { subscription: sub.toObject() }, "Subscription updated.");
  } catch (err) {
    logger.error("LiveCourseSubscription update failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to update subscription.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/subscriptions/:subscriptionId
// Hard delete — for cleaning up test/erroneous rows. To revoke a real
// customer's access prefer PUT { status: false }, which keeps the audit trail.
export const deleteLiveCourseSubscription = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subscriptionId ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid subscription id.", 422);
    }

    const out = await LiveCourseSubscription.findByIdAndDelete(id);
    if (!out) return failure(res, "Subscription not found.", 404);

    logger.info("LiveCourseSubscription deleted", { subscriptionId: id, by: req.user?.id });
    return success(res, { id }, "Subscription deleted.");
  } catch (err) {
    logger.error("LiveCourseSubscription delete failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to delete subscription.", 500);
  }
};
