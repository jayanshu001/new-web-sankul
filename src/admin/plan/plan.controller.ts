import { Request, Response } from "express";
import {
  createPlanSchema,
  updatePlanSchema,
  bulkStatusSchema,
  bulkDeleteSchema,
} from "./plan.validation";
import * as planSql from "../../modules/admin-plan/admin-plan.service";

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const listPlans = async (req: Request, res: Response) => {
  try {
    const {
      entityType,
      courseId,
      packageId,
      ebookId,
      status,
      isDefault,
      withMaterial,
      search,
      sortBy,
      sortOrder,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum0 = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum0 = Math.max(parseInt(limit, 10) || 20, 1);
    const sortDir: "asc" | "desc" = sortOrder === "asc" ? "asc" : "desc";

    const { items, total } = await planSql.listPlans({ entityType, courseId, packageId, ebookId, status, isDefault, withMaterial, search, sortBy, sortDir, page: pageNum0, limit: limitNum0 });
    return res.status(200).json({ success: true, data: items, pagination: { total, page: pageNum0, limit: limitNum0, totalPages: Math.ceil(total / limitNum0) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPlanById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = planSql.parsePlanId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
    const data = await planSql.getPlanById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Plan not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPlan = async (req: Request, res: Response) => {
  try {
    const data = createPlanSchema.parse(req.body);

    const created = await planSql.createPlan(data as any);
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePlan = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const numId = planSql.parsePlanId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
    const data = updatePlanSchema.parse(req.body);
    const updated = await planSql.updatePlan(numId, data as any);
    if (!updated) return res.status(404).json({ success: false, message: "Plan not found." });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = planSql.parsePlanId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
    const r = await planSql.deletePlan(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Plan not found." });
    if (r === "has_subscribers") return res.status(400).json({ success: false, message: "Plan has subscribers; archive (set status=false) instead." });
    return res.status(200).json({ success: true, message: "Plan deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePlanStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = planSql.parsePlanId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
    const newStatus = await planSql.togglePlanStatus(numId);
    if (newStatus === null) return res.status(404).json({ success: false, message: "Plan not found." });
    return res.status(200).json({ success: true, data: { status: newStatus } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const markAsDefault = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const numId = planSql.parsePlanId(id);
  if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
  const r = await planSql.markAsDefault(numId);
  if (r === "not_found") return res.status(404).json({ success: false, message: "Plan not found." });
  if (r === "no_owner") return res.status(400).json({ success: false, message: "Plan is not attached to any course/package/ebook." });
  return res.status(200).json({ success: true, data: r });
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkStatusSchema.parse(req.body);

    const numIds = ids.map((i) => planSql.parsePlanId(i)).filter((n): n is number => n !== null);
    if (!numIds.length) return res.status(400).json({ success: false, message: "No valid ids." });
    const modified = await planSql.bulkStatus(numIds, status);
    return res.status(200).json({ success: true, modified });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkDeleteSchema.parse(req.body);

    const numIds = ids.map((i) => planSql.parsePlanId(i)).filter((n): n is number => n !== null);
    if (!numIds.length) return res.status(400).json({ success: false, message: "No valid ids." });
    const r = await planSql.bulkDelete(numIds);
    if (!r.ok) return res.status(400).json({ success: false, message: "One or more plans have subscribers; remove those first." });
    return res.status(200).json({ success: true, deleted: r.deleted });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const clonePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { targetCourseId, targetPackageId, targetEbookId } = req.body as Record<string, string>;

    const numId = planSql.parsePlanId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
    const r = await planSql.clonePlan(numId, { courseId: targetCourseId, packageId: targetPackageId, ebookId: targetEbookId });
    if (r === "not_found") return res.status(404).json({ success: false, message: "Plan not found." });
    if (r === "bad_target") return res.status(400).json({ success: false, message: "Exactly one of targetCourseId, targetPackageId, targetEbookId is required." });
    return res.status(201).json({ success: true, data: r });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
