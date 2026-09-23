import { Request, Response } from "express";
import { z } from "zod";
import {
  createStateSchema, updateStateSchema,
  createEducationSchema, updateEducationSchema,
  createTargetGoalSchema, updateTargetGoalSchema,
} from "./customer-master.validation";
import {
  parseId,
  listStates as sqlListStates, createState as sqlCreateState, updateState as sqlUpdateState, deleteState as sqlDeleteState,
  listDistricts as sqlListDistricts, createDistrict as sqlCreateDistrict, updateDistrict as sqlUpdateDistrict, deleteDistrict as sqlDeleteDistrict,
  listEducations as sqlListEducations, createEducation as sqlCreateEducation, updateEducation as sqlUpdateEducation, deleteEducation as sqlDeleteEducation,
  listTargetGoals as sqlListTargetGoals, createTargetGoal as sqlCreateTargetGoal, updateTargetGoal as sqlUpdateTargetGoal, deleteTargetGoal as sqlDeleteTargetGoal,
} from "../../modules/customer-master/customer-master.service";

// District bodies carry stateId as a numeric int on the SQL path. Numeric-tolerant
// variant used by the SQL branch.
const createDistrictSqlSchema = z.object({
  name: z.string().min(1).max(255),
  stateId: z.coerce.number().int().positive(),
  active: z.boolean().optional().default(true),
});
const updateDistrictSqlSchema = createDistrictSqlSchema.partial();
const toBool = (v?: string) => (v === "true" ? true : v === "false" ? false : undefined);

// ─── States ───────────────────────────────────────────────────────────────────

export const getStates = async (req: Request, res: Response) => {
  try {
    // Pagination is opt-in: only when page/limit is passed (preserves the full-list
    // contract for dropdown consumers). `search` matches name + stateCode.
    const { active, search, page, limit } = req.query as Record<string, string>;
    const paginate = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
    const meta = (total: number) => ({
      total,
      page: paginate ? pageNum : 1,
      limit: paginate ? limitNum : total,
      totalPages: paginate ? Math.ceil(total / limitNum) : 1,
    });

    const { data, total } = await sqlListStates({
      active: toBool(active),
      search: search?.trim() || undefined,
      skip: paginate ? (pageNum - 1) * limitNum : undefined,
      take: paginate ? limitNum : undefined,
    });
    return res.status(200).json({ success: true, data, pagination: meta(total) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createState = async (req: Request, res: Response) => {
  try {
    const data = createStateSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await sqlCreateState(data) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateState = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid State ID" });
    const data = updateStateSchema.parse(req.body);
    const r = await sqlUpdateState(nid, data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteState = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid State ID" });
    const r = await sqlDeleteState(nid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "State deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Districts ────────────────────────────────────────────────────────────────

export const getDistricts = async (req: Request, res: Response) => {
  try {
    const { stateId, active } = req.query as Record<string, string>;
    const filter: { stateId?: number; active?: boolean } = { active: toBool(active) };
    if (stateId) {
      const sid = parseId(stateId);
      if (sid == null) return res.status(400).json({ success: false, message: "Invalid stateId" });
      filter.stateId = sid;
    }
    return res.status(200).json({ success: true, data: await sqlListDistricts(filter) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createDistrict = async (req: Request, res: Response) => {
  try {
    const data = createDistrictSqlSchema.parse(req.body);
    const r = await sqlCreateDistrict(data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(201).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateDistrict = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid District ID" });
    const data = updateDistrictSqlSchema.parse(req.body);
    const r = await sqlUpdateDistrict(nid, data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteDistrict = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid District ID" });
    const r = await sqlDeleteDistrict(nid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "District deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Educations ───────────────────────────────────────────────────────────────

export const getEducations = async (req: Request, res: Response) => {
  try {
    const { status } = req.query as Record<string, string>;
    return res.status(200).json({ success: true, data: await sqlListEducations(toBool(status)) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createEducation = async (req: Request, res: Response) => {
  try {
    const data = createEducationSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await sqlCreateEducation(data) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEducation = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid Education ID" });
    const data = updateEducationSchema.parse(req.body);
    const r = await sqlUpdateEducation(nid, data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEducation = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid Education ID" });
    const r = await sqlDeleteEducation(nid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "Education deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Target Goals ─────────────────────────────────────────────────────────────

export const getTargetGoals = async (req: Request, res: Response) => {
  try {
    const { active } = req.query as Record<string, string>;
    return res.status(200).json({ success: true, data: await sqlListTargetGoals(toBool(active)) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTargetGoal = async (req: Request, res: Response) => {
  try {
    const data = createTargetGoalSchema.parse(req.body);
    return res.status(201).json({ success: true, data: await sqlCreateTargetGoal(data) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTargetGoal = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
    const data = updateTargetGoalSchema.parse(req.body);
    const r = await sqlUpdateTargetGoal(nid, data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTargetGoal = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
    const r = await sqlDeleteTargetGoal(nid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "Target Goal deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
