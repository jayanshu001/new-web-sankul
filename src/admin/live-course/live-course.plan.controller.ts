import { Request, Response } from "express";
import { z } from "zod";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

const createPlanSchema = z
  .object({
    name:      z.string().trim().max(200).optional(),
    duration:  z.number().int().positive("duration (days) must be a positive integer"),
    price:     z.number().nonnegative("price must be a non-negative number"),
    // MRP shown struck-through next to `price`. Optional.
    originalPrice: z.number().nonnegative("originalPrice must be a non-negative number").optional(),
    // Per-plan material variant (mirrors Course/Package). withMaterial marks the
    // plan as shipping physical material; materialPrice is the material portion.
    withMaterial: z.boolean().optional().default(false),
    materialPrice: z.number().nonnegative("materialPrice must be a non-negative number").optional(),
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

  const cid = liveSql.parseLiveId(liveCourseId);
  if (!cid) return failure(res, "Invalid live course id.", 422);
  let v: z.infer<typeof createPlanSchema>;
  try { v = createPlanSchema.parse(req.body); } catch (err) { if (err instanceof z.ZodError) return zodIssueResponse(res, err); throw err; }
  const r = await liveSql.createPlan(cid, v);
  if (r === "not_found") return failure(res, "Live course not found.", 404);
  return success(res, { plan: r }, "Plan created.", 201);
};

// GET /api/v1/admin/live-courses/:id/plans
export const listLiveCoursePlans = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.id ?? "");
  logger.info("listLiveCoursePlans invoked", { traceId, path: req.originalUrl, liveCourseId, userId: req.user?.id });

  try {
    const cid = liveSql.parseLiveId(liveCourseId);
    if (!cid) return failure(res, "Invalid live course id.", 422);
    const plans = await liveSql.listPlans(cid);
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
    const pid = liveSql.parseLiveId(planId);
    if (!pid) return failure(res, "Invalid plan id.", 422);
    const r = await liveSql.getPlan(pid);
    if (r === "not_found") return failure(res, "Plan not found.", 404);
    return success(res, { plan: r }, "Plan fetched.");
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

  const pid = liveSql.parseLiveId(planId);
  if (!pid) return failure(res, "Invalid plan id.", 422);
  let v: z.infer<typeof updatePlanSchema>;
  try { v = updatePlanSchema.parse(req.body); } catch (err) { if (err instanceof z.ZodError) return zodIssueResponse(res, err); throw err; }
  const r = await liveSql.updatePlan(pid, v);
  if (r === "not_found") return failure(res, "Plan not found.", 404);
  return success(res, { plan: r }, "Plan updated.");
};

// DELETE /api/v1/admin/live-courses/plans/:planId
// Refuses if any verified subscriptions point at the plan — prevents stranding
// paying customers when admin tries to clean up.
export const deleteLiveCoursePlan = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const planId = String(req.params.planId ?? "");
  logger.info("deleteLiveCoursePlan invoked", { traceId, path: req.originalUrl, planId, userId: req.user?.id });

  try {
    const pid = liveSql.parseLiveId(planId);
    if (!pid) return failure(res, "Invalid plan id.", 422);
    const r = await liveSql.deletePlan(pid);
    if (r === "not_found") return failure(res, "Plan not found.", 404);
    if (r === "has_subs") return failure(res, "Cannot delete: verified subscription(s) reference this plan. Toggle status off instead.", 409);
    return success(res, { id: planId }, "Plan deleted.");
  } catch (err) {
    logger.error("deleteLiveCoursePlan failed", { traceId, planId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete plan.", 500);
  }
};
