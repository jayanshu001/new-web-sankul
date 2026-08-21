import { Request, Response } from "express";
import { planInUseMessage } from "../../utils/planUsage";
import { PLAN_TERMS_FROZEN_MESSAGE } from "../../modules/admin-plan/admin-plan.service";
import { z } from "zod";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";
import { parseListQuery } from "../../utils/listQuery";

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
    const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const { data, pagination } = await liveSql.listPlans(cid, { skip, take: limit, page, limit });
    return res.status(200).json({ success: true, data, pagination });
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
  if (r === "frozen_terms") return failure(res, PLAN_TERMS_FROZEN_MESSAGE, 422);
  return success(res, { plan: r }, "Plan updated.");
};

// DELETE /api/v1/admin/live-courses/plans/:planId
// Refuses if ANY subscription row points at the plan — verified, pending or failed,
// expired or live. Deleting a referenced plan strands the rows that point at it.
export const deleteLiveCoursePlan = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const planId = String(req.params.planId ?? "");
  logger.info("deleteLiveCoursePlan invoked", { traceId, path: req.originalUrl, planId, userId: req.user?.id });

  try {
    const pid = liveSql.parseLiveId(planId);
    if (!pid) return failure(res, "Invalid plan id.", 422);
    const r = await liveSql.deletePlan(pid);
    if (r === "not_found") return failure(res, "Plan not found.", 404);
    if (typeof r === "object") return failure(res, planInUseMessage(r.inUse), 409);
    return success(res, { id: planId }, "Plan deleted.");
  } catch (err) {
    logger.error("deleteLiveCoursePlan failed", { traceId, planId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete plan.", 500);
  }
};
