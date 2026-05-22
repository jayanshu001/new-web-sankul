import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

const createPlanSchema = z
  .object({
    name:      z.string().trim().max(200).optional(),
    duration:  z.number().int().positive("duration (months) must be a positive integer"),
    price:     z.number().nonnegative("price must be a non-negative number"),
    // MRP shown struck-through next to `price`. Optional.
    originalPrice: z.number().nonnegative("originalPrice must be a non-negative number").optional(),
    isDefault: z.boolean().optional().default(false),
    status:    z.boolean().optional().default(true),
  })
  .strict();

const updatePlanSchema = createPlanSchema.partial().strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

// POST /api/v1/admin/live-courses/:id/plans
export const createLiveCoursePlan = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.id ?? "");
  logger.info("createLiveCoursePlan invoked", { traceId, path: req.originalUrl, liveCourseId, userId: req.user?.id });

  const txn = await mongoose.startSession();
  try {
    if (!mongoose.Types.ObjectId.isValid(liveCourseId)) {
      logger.warn("createLiveCoursePlan invalid id", { traceId, liveCourseId });
      return failure(res, "Invalid live course id.", 422);
    }
    const exists = await LiveCourse.exists({ _id: liveCourseId });
    if (!exists) {
      logger.warn("createLiveCoursePlan course not found", { traceId, liveCourseId });
      return failure(res, "Live course not found.", 404);
    }

    let validated: z.infer<typeof createPlanSchema>;
    try {
      validated = createPlanSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn("createLiveCoursePlan validation failed", { traceId, liveCourseId, issues: err.issues });
        return zodIssueResponse(res, err);
      }
      throw err;
    }

    txn.startTransaction();

    // If this plan is marked default, unset any other defaults on this course.
    if (validated.isDefault) {
      await LiveCoursePlan.updateMany(
        { liveCourseId, isDefault: true },
        { $set: { isDefault: false } },
        { session: txn }
      );
    }

    const [plan] = await LiveCoursePlan.create(
      [{ ...validated, liveCourseId }],
      { session: txn }
    );

    await txn.commitTransaction();
    logger.info("createLiveCoursePlan success", { traceId, liveCourseId, planId: plan._id });
    return success(res, { plan: plan.toObject() }, "Plan created.", 201);
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("createLiveCoursePlan failed", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create plan.", 500);
  } finally {
    txn.endSession();
  }
};

// GET /api/v1/admin/live-courses/:id/plans
export const listLiveCoursePlans = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.id ?? "");
  logger.info("listLiveCoursePlans invoked", { traceId, path: req.originalUrl, liveCourseId, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(liveCourseId)) {
      logger.warn("listLiveCoursePlans invalid id", { traceId, liveCourseId });
      return failure(res, "Invalid live course id.", 422);
    }
    const plans = await LiveCoursePlan.find({ liveCourseId })
      .sort({ isDefault: -1, price: 1, createdAt: 1 })
      .lean();
    logger.info("listLiveCoursePlans success", { traceId, liveCourseId, count: plans.length });
    return success(res, { plans, total: plans.length }, "Plans fetched.");
  } catch (err) {
    logger.error("listLiveCoursePlans failed", { traceId, liveCourseId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list plans.", 500);
  }
};

// GET /api/v1/admin/live-courses/plans/:planId
export const getLiveCoursePlan = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const planId = String(req.params.planId ?? "");
  logger.info("getLiveCoursePlan invoked", { traceId, path: req.originalUrl, planId, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("getLiveCoursePlan invalid id", { traceId, planId });
      return failure(res, "Invalid plan id.", 422);
    }
    const plan = await LiveCoursePlan.findById(planId).lean();
    if (!plan) {
      logger.warn("getLiveCoursePlan not found", { traceId, planId });
      return failure(res, "Plan not found.", 404);
    }
    logger.info("getLiveCoursePlan success", { traceId, planId });
    return success(res, { plan }, "Plan fetched.");
  } catch (err) {
    logger.error("getLiveCoursePlan failed", { traceId, planId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch plan.", 500);
  }
};

// PUT /api/v1/admin/live-courses/plans/:planId
export const updateLiveCoursePlan = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const planId = String(req.params.planId ?? "");
  logger.info("updateLiveCoursePlan invoked", { traceId, path: req.originalUrl, planId, userId: req.user?.id });

  const txn = await mongoose.startSession();
  try {
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("updateLiveCoursePlan invalid id", { traceId, planId });
      return failure(res, "Invalid plan id.", 422);
    }

    let validated: z.infer<typeof updatePlanSchema>;
    try {
      validated = updatePlanSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn("updateLiveCoursePlan validation failed", { traceId, planId, issues: err.issues });
        return zodIssueResponse(res, err);
      }
      throw err;
    }

    txn.startTransaction();

    const plan = await LiveCoursePlan.findById(planId).session(txn);
    if (!plan) {
      await txn.abortTransaction();
      logger.warn("updateLiveCoursePlan not found", { traceId, planId });
      return failure(res, "Plan not found.", 404);
    }

    if (validated.isDefault === true) {
      await LiveCoursePlan.updateMany(
        { liveCourseId: plan.liveCourseId, isDefault: true, _id: { $ne: plan._id } },
        { $set: { isDefault: false } },
        { session: txn }
      );
    }

    Object.assign(plan, validated);
    await plan.save({ session: txn });

    await txn.commitTransaction();
    logger.info("updateLiveCoursePlan success", { traceId, planId });
    return success(res, { plan: plan.toObject() }, "Plan updated.");
  } catch (err) {
    if (txn.inTransaction()) await txn.abortTransaction();
    logger.error("updateLiveCoursePlan failed", { traceId, planId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update plan.", 500);
  } finally {
    txn.endSession();
  }
};

// DELETE /api/v1/admin/live-courses/plans/:planId
// Refuses if any verified subscriptions point at the plan — prevents stranding
// paying customers when admin tries to clean up.
export const deleteLiveCoursePlan = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const planId = String(req.params.planId ?? "");
  logger.info("deleteLiveCoursePlan invoked", { traceId, path: req.originalUrl, planId, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("deleteLiveCoursePlan invalid id", { traceId, planId });
      return failure(res, "Invalid plan id.", 422);
    }

    const liveSubs = await LiveCourseSubscription.countDocuments({
      planId,
      paymentStatus: "verified",
    });
    if (liveSubs > 0) {
      logger.warn("deleteLiveCoursePlan refused active subs", { traceId, planId, liveSubs });
      return failure(
        res,
        `Cannot delete: ${liveSubs} verified subscription(s) reference this plan. Toggle status off instead.`,
        409
      );
    }

    const out = await LiveCoursePlan.findByIdAndDelete(planId);
    if (!out) {
      logger.warn("deleteLiveCoursePlan not found", { traceId, planId });
      return failure(res, "Plan not found.", 404);
    }
    logger.info("deleteLiveCoursePlan success", { traceId, planId });
    return success(res, { id: planId }, "Plan deleted.");
  } catch (err) {
    logger.error("deleteLiveCoursePlan failed", { traceId, planId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete plan.", 500);
  }
};
