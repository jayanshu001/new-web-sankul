import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { CustomerDistrict } from "../../models/customer/CustomerDistrict.model";
import { CustomerEducation } from "../../models/customer/CustomerEducation.model";
import { CustomerTargetGoal } from "../../models/customer/CustomerTargetGoal.model";
import { z } from "zod";
import {
  createStateSchema, updateStateSchema,
  createDistrictSchema, updateDistrictSchema,
  createEducationSchema, updateEducationSchema,
  createTargetGoalSchema, updateTargetGoalSchema,
} from "./customer-master.validation";
import {
  isCustomerMasterMysql, parseId,
  listStates as sqlListStates, createState as sqlCreateState, updateState as sqlUpdateState, deleteState as sqlDeleteState,
  listDistricts as sqlListDistricts, createDistrict as sqlCreateDistrict, updateDistrict as sqlUpdateDistrict, deleteDistrict as sqlDeleteDistrict,
  listEducations as sqlListEducations, createEducation as sqlCreateEducation, updateEducation as sqlUpdateEducation, deleteEducation as sqlDeleteEducation,
  listTargetGoals as sqlListTargetGoals, createTargetGoal as sqlCreateTargetGoal, updateTargetGoal as sqlUpdateTargetGoal, deleteTargetGoal as sqlDeleteTargetGoal,
} from "../../modules/customer-master/customer-master.service";

// District bodies carry stateId as a 24-hex ObjectId on Mongo but a numeric
// int on the SQL path. Numeric-tolerant variants used only by the SQL branch.
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

    if (isCustomerMasterMysql()) {
      const { data, total } = await sqlListStates({
        active: toBool(active),
        search: search?.trim() || undefined,
        skip: paginate ? (pageNum - 1) * limitNum : undefined,
        take: paginate ? limitNum : undefined,
      });
      return res.status(200).json({ success: true, data, pagination: meta(total) });
    }

    const filters: any = {};
    if (active === "true" || active === "false") filters.active = active === "true";
    if (search && search.trim()) {
      const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filters.$or = [{ name: { $regex: safe, $options: "i" } }, { stateCode: { $regex: safe, $options: "i" } }];
    }
    const query = CustomerState.find(filters).sort({ _id: -1 }); // newest first
    if (paginate) query.skip((pageNum - 1) * limitNum).limit(limitNum);
    const [states, total] = await Promise.all([query.lean(), CustomerState.countDocuments(filters)]);
    return res.status(200).json({ success: true, data: states, pagination: meta(total) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createState = async (req: Request, res: Response) => {
  try {
    const data = createStateSchema.parse(req.body);
    if (isCustomerMasterMysql()) {
      return res.status(201).json({ success: true, data: await sqlCreateState(data) });
    }
    const state = new CustomerState(data);
    await state.save();
    return res.status(201).json({ success: true, data: state });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateState = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid State ID" });
      const data = updateStateSchema.parse(req.body);
      const r = await sqlUpdateState(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid State ID" });
    const data = updateStateSchema.parse(req.body);
    const state = await CustomerState.findByIdAndUpdate(id, data, { new: true });
    if (!state) return res.status(404).json({ success: false, message: "State not found" });
    return res.status(200).json({ success: true, data: state });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteState = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid State ID" });
      const r = await sqlDeleteState(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "State deleted successfully" });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid State ID" });
    const state = await CustomerState.findByIdAndDelete(id);
    if (!state) return res.status(404).json({ success: false, message: "State not found" });
    return res.status(200).json({ success: true, message: "State deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Districts ────────────────────────────────────────────────────────────────

export const getDistricts = async (req: Request, res: Response) => {
  try {
    const { stateId, active } = req.query as Record<string, string>;
    if (isCustomerMasterMysql()) {
      const filter: { stateId?: number; active?: boolean } = { active: toBool(active) };
      if (stateId) {
        const sid = parseId(stateId);
        if (sid == null) return res.status(400).json({ success: false, message: "Invalid stateId" });
        filter.stateId = sid;
      }
      return res.status(200).json({ success: true, data: await sqlListDistricts(filter) });
    }
    const filters: any = {};
    if (stateId) {
      if (!mongoose.Types.ObjectId.isValid(stateId))
        return res.status(400).json({ success: false, message: "Invalid stateId" });
      filters.stateId = stateId;
    }
    if (active === "true" || active === "false") filters.active = active === "true";
    const districts = await CustomerDistrict.find(filters)
      .populate("stateId", "_id name stateCode")
      .sort({ name: 1 });
    return res.status(200).json({ success: true, data: districts });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createDistrict = async (req: Request, res: Response) => {
  try {
    if (isCustomerMasterMysql()) {
      const data = createDistrictSqlSchema.parse(req.body);
      const r = await sqlCreateDistrict(data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(201).json({ success: true, data: r.data });
    }
    const data = createDistrictSchema.parse(req.body);
    const stateExists = await CustomerState.exists({ _id: data.stateId });
    if (!stateExists)
      return res.status(404).json({ success: false, message: "State not found" });
    const district = new CustomerDistrict(data);
    await district.save();
    return res.status(201).json({ success: true, data: district });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateDistrict = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid District ID" });
      const data = updateDistrictSqlSchema.parse(req.body);
      const r = await sqlUpdateDistrict(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid District ID" });
    const data = updateDistrictSchema.parse(req.body);
    if (data.stateId) {
      const stateExists = await CustomerState.exists({ _id: data.stateId });
      if (!stateExists)
        return res.status(404).json({ success: false, message: "State not found" });
    }
    const district = await CustomerDistrict.findByIdAndUpdate(id, data, { new: true });
    if (!district) return res.status(404).json({ success: false, message: "District not found" });
    return res.status(200).json({ success: true, data: district });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteDistrict = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid District ID" });
      const r = await sqlDeleteDistrict(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "District deleted successfully" });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid District ID" });
    const district = await CustomerDistrict.findByIdAndDelete(id);
    if (!district) return res.status(404).json({ success: false, message: "District not found" });
    return res.status(200).json({ success: true, message: "District deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Educations ───────────────────────────────────────────────────────────────

export const getEducations = async (req: Request, res: Response) => {
  try {
    const { status } = req.query as Record<string, string>;
    if (isCustomerMasterMysql()) {
      return res.status(200).json({ success: true, data: await sqlListEducations(toBool(status)) });
    }
    const filters: any = {};
    if (status === "true" || status === "false") filters.status = status === "true";
    const educations = await CustomerEducation.find(filters).sort({ name: 1 });
    return res.status(200).json({ success: true, data: educations });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createEducation = async (req: Request, res: Response) => {
  try {
    const data = createEducationSchema.parse(req.body);
    if (isCustomerMasterMysql()) {
      return res.status(201).json({ success: true, data: await sqlCreateEducation(data) });
    }
    const education = new CustomerEducation(data);
    await education.save();
    return res.status(201).json({ success: true, data: education });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEducation = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid Education ID" });
      const data = updateEducationSchema.parse(req.body);
      const r = await sqlUpdateEducation(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Education ID" });
    const data = updateEducationSchema.parse(req.body);
    const education = await CustomerEducation.findByIdAndUpdate(id, data, { new: true });
    if (!education) return res.status(404).json({ success: false, message: "Education not found" });
    return res.status(200).json({ success: true, data: education });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEducation = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid Education ID" });
      const r = await sqlDeleteEducation(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "Education deleted successfully" });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Education ID" });
    const education = await CustomerEducation.findByIdAndDelete(id);
    if (!education) return res.status(404).json({ success: false, message: "Education not found" });
    return res.status(200).json({ success: true, message: "Education deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Target Goals ─────────────────────────────────────────────────────────────

export const getTargetGoals = async (req: Request, res: Response) => {
  try {
    const { active } = req.query as Record<string, string>;
    if (isCustomerMasterMysql()) {
      return res.status(200).json({ success: true, data: await sqlListTargetGoals(toBool(active)) });
    }
    const filters: any = {};
    if (active === "true" || active === "false") filters.active = active === "true";
    const goals = await CustomerTargetGoal.find(filters).sort({ name: 1 });
    return res.status(200).json({ success: true, data: goals });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTargetGoal = async (req: Request, res: Response) => {
  try {
    const data = createTargetGoalSchema.parse(req.body);
    if (isCustomerMasterMysql()) {
      return res.status(201).json({ success: true, data: await sqlCreateTargetGoal(data) });
    }
    const goal = new CustomerTargetGoal(data);
    await goal.save();
    return res.status(201).json({ success: true, data: goal });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTargetGoal = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
      const data = updateTargetGoalSchema.parse(req.body);
      const r = await sqlUpdateTargetGoal(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
    const data = updateTargetGoalSchema.parse(req.body);
    const goal = await CustomerTargetGoal.findByIdAndUpdate(id, data, { new: true });
    if (!goal) return res.status(404).json({ success: false, message: "Target Goal not found" });
    return res.status(200).json({ success: true, data: goal });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTargetGoal = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isCustomerMasterMysql()) {
      const nid = parseId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
      const r = await sqlDeleteTargetGoal(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "Target Goal deleted successfully" });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
    const goal = await CustomerTargetGoal.findByIdAndDelete(id);
    if (!goal) return res.status(404).json({ success: false, message: "Target Goal not found" });
    return res.status(200).json({ success: true, message: "Target Goal deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
