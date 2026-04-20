import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { CustomerDistrict } from "../../models/customer/CustomerDistrict.model";
import { CustomerEducation } from "../../models/customer/CustomerEducation.model";
import { CustomerTargetGoal } from "../../models/customer/CustomerTargetGoal.model";
import {
  createStateSchema, updateStateSchema,
  createDistrictSchema, updateDistrictSchema,
  createEducationSchema, updateEducationSchema,
  createTargetGoalSchema, updateTargetGoalSchema,
} from "./customer-master.validation";

// ─── States ───────────────────────────────────────────────────────────────────

export const getStates = async (req: Request, res: Response) => {
  try {
    const { active } = req.query as Record<string, string>;
    const filters: any = {};
    if (active === "true" || active === "false") filters.active = active === "true";
    const states = await CustomerState.find(filters).sort({ name: 1 });
    return res.status(200).json({ success: true, data: states });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createState = async (req: Request, res: Response) => {
  try {
    const data = createStateSchema.parse(req.body);
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
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Target Goal ID" });
    const goal = await CustomerTargetGoal.findByIdAndDelete(id);
    if (!goal) return res.status(404).json({ success: false, message: "Target Goal not found" });
    return res.status(200).json({ success: true, message: "Target Goal deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
