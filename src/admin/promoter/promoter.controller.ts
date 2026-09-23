import { Request, Response } from "express";
import { createPromoterSchema, updatePromoterSchema } from "./promoter.validation";
import * as adminPromoterSql from "../../modules/admin-promoter/admin-promoter.service";

// GET /api/v1/admin/promoters
export const listPromoters = async (req: Request, res: Response) => {
  try {
    const { search, status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    const statusFilter = status === "true" ? true : status === "false" ? false : undefined;
    const { data, total } = await adminPromoterSql.listPromoters({
      search,
      status: statusFilter,
      page: pageNum,
      limit: limitNum,
    });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/:id
export const getPromoter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await adminPromoterSql.getPromoter(pid);
    if (!data) return res.status(404).json({ success: false, message: "Promoter not found." });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/admin/promoters
export const createPromoter = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const data = createPromoterSchema.parse(req.body);

    const result = await adminPromoterSql.createPromoter(data);
    if (result.conflict)
      return res.status(409).json({ success: false, message: "Email already in use." });
    return res.status(201).json({ success: true, data: result.data });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /api/v1/admin/promoters/:id
export const updatePromoter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const data = updatePromoterSchema.parse(req.body);

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid id." });
    const updated = await adminPromoterSql.updatePromoter(pid, data);
    if (!updated) return res.status(404).json({ success: false, message: "Promoter not found." });
    return res.status(200).json({ success: true, data: updated });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/admin/promoters/:id — soft delete
export const deletePromoter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await adminPromoterSql.deletePromoter(pid);
    if (!ok) return res.status(404).json({ success: false, message: "Promoter not found." });
    return res.status(200).json({ success: true, message: "Promoter deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// PATCH /api/v1/admin/promoters/:id/status
export const togglePromoterStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid id." });
    const next = await adminPromoterSql.togglePromoterStatus(pid);
    if (next === null) return res.status(404).json({ success: false, message: "Promoter not found." });
    return res.status(200).json({ success: true, data: { status: next } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/:id/promocodes
export const getPromoterPromocodes = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await adminPromoterSql.getPromoterPromocodes(pid);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/:id/subscriptions
export const getPromoterSubscriptions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await adminPromoterSql.getPromoterSubscriptions(pid);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/:id/dashboard?range=today|week|month|year|all
// Admin view of a specific promoter's dashboard — same shape as the promoter's
// self-view at /api/v1/promoter/dashboard/overview.
export const getPromoterDashboard = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const pid = adminPromoterSql.parsePromoterId(id);
    if (!pid) return res.status(400).json({ success: false, message: "Invalid promoter id." });
    const { range, startDate, endDate, promocodeId } = req.query as Record<string, string>;
    const data = await adminPromoterSql.getPromoterDashboard(pid, {
      rangeRaw: range,
      startDate,
      endDate,
      promocodeId,
    });
    if (!data) return res.status(404).json({ success: false, message: "Promoter not found." });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/dashboard
// Aggregate dashboard across all promoters. Same response shape as the
// per-promoter view; supports the same range presets + custom date range.
export const getAllPromotersDashboard = async (req: Request, res: Response) => {
  try {
    const { range, startDate, endDate, promocodeId } = req.query as Record<string, string>;

    const data = await adminPromoterSql.getAllPromotersDashboard({
      rangeRaw: range,
      startDate,
      endDate,
      promocodeId,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
