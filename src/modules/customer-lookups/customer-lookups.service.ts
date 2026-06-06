import mongoose from "mongoose";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { CustomerDistrict } from "../../models/customer/CustomerDistrict.model";
import { CustomerEducation } from "../../models/customer/CustomerEducation.model";
import { CustomerTargetGoal } from "../../models/customer/CustomerTargetGoal.model";
import { isMysqlModule } from "../../config/migration";
import { customerLookupsRepository as repo } from "./customer-lookups.repository";
import {
  toStateDto,
  toDistrictDto,
  toEducationDto,
  toTargetGoalDto,
} from "./customer-lookups.transformer";
import type {
  StateDto,
  DistrictDto,
  EducationDto,
  TargetGoalDto,
  StateInput,
  DistrictInput,
  EducationInput,
  TargetGoalInput,
} from "./customer-lookups.types";

const MODULE = "customer-lookups";

export const parseLookupId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const isMysql = () => isMysqlModule(MODULE);
const oid = (v: unknown) => String(v);

// ─── States ────────────────────────────────────────────────────────────────
export const listStates = async (opts?: {
  activeOnly?: boolean;
  search?: string;
}): Promise<StateDto[]> => {
  if (isMysql()) {
    const rows = await repo.listStates(opts);
    return rows.map(toStateDto);
  }
  const filter: Record<string, unknown> = {};
  if (opts?.activeOnly) filter.active = true;
  if (opts?.search) filter.name = { $regex: opts.search, $options: "i" };
  const docs = await CustomerState.find(filter).sort({ name: 1 }).lean();
  return docs.map((d) => ({
    _id: oid(d._id),
    name: d.name,
    stateCode: d.stateCode,
    active: d.active,
  }));
};

export const createState = async (input: StateInput): Promise<StateDto> => {
  if (isMysql()) return toStateDto(await repo.createState(input));
  const doc = await CustomerState.create({ ...input, active: input.active ?? true });
  return { _id: oid(doc._id), name: doc.name, stateCode: doc.stateCode, active: doc.active };
};

export const updateState = async (
  id: string,
  input: Partial<StateInput>
): Promise<StateDto | null> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return null;
    try {
      return toStateDto(await repo.updateState(n, input));
    } catch {
      return null;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CustomerState.findByIdAndUpdate(id, { $set: input }, { new: true }).lean();
  return doc
    ? { _id: oid(doc._id), name: doc.name, stateCode: doc.stateCode, active: doc.active }
    : null;
};

export const deleteState = async (id: string): Promise<boolean> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return false;
    try {
      await repo.deleteState(n);
      return true;
    } catch {
      return false;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  return !!(await CustomerState.findByIdAndDelete(id));
};

// ─── Districts ───────────────────────────────────────────────────────────────
export const listDistrictsByState = async (
  stateId: string,
  opts?: { activeOnly?: boolean }
): Promise<DistrictDto[]> => {
  if (isMysql()) {
    const n = parseLookupId(stateId);
    const rows = await repo.listDistricts({ stateId: n ?? undefined, activeOnly: opts?.activeOnly });
    return rows.map(toDistrictDto);
  }
  const filter: Record<string, unknown> = {};
  if (stateId && mongoose.Types.ObjectId.isValid(stateId)) filter.stateId = stateId;
  if (opts?.activeOnly) filter.active = true;
  const docs = await CustomerDistrict.find(filter).sort({ name: 1 }).lean();
  return docs.map((d) => ({
    _id: oid(d._id),
    name: d.name,
    stateId: oid(d.stateId),
    active: d.active,
  }));
};

export const createDistrict = async (input: DistrictInput): Promise<DistrictDto> => {
  if (isMysql()) return toDistrictDto(await repo.createDistrict(input));
  const doc = await CustomerDistrict.create({ ...input, active: input.active ?? true });
  return { _id: oid(doc._id), name: doc.name, stateId: oid(doc.stateId), active: doc.active };
};

export const updateDistrict = async (
  id: string,
  input: Partial<DistrictInput>
): Promise<DistrictDto | null> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return null;
    try {
      return toDistrictDto(await repo.updateDistrict(n, input));
    } catch {
      return null;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CustomerDistrict.findByIdAndUpdate(id, { $set: input }, { new: true }).lean();
  return doc
    ? { _id: oid(doc._id), name: doc.name, stateId: oid(doc.stateId), active: doc.active }
    : null;
};

export const deleteDistrict = async (id: string): Promise<boolean> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return false;
    try {
      await repo.deleteDistrict(n);
      return true;
    } catch {
      return false;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  return !!(await CustomerDistrict.findByIdAndDelete(id));
};

// ─── Educations ──────────────────────────────────────────────────────────────
export const listEducations = async (opts?: {
  activeOnly?: boolean;
}): Promise<EducationDto[]> => {
  if (isMysql()) {
    const rows = await repo.listEducations(opts);
    return rows.map(toEducationDto);
  }
  const filter: Record<string, unknown> = {};
  if (opts?.activeOnly) filter.status = true;
  const docs = await CustomerEducation.find(filter).sort({ name: 1 }).lean();
  return docs.map((d) => ({ _id: oid(d._id), name: d.name, status: d.status }));
};

export const createEducation = async (input: EducationInput): Promise<EducationDto> => {
  if (isMysql()) return toEducationDto(await repo.createEducation(input));
  const doc = await CustomerEducation.create({ ...input, status: input.status ?? true });
  return { _id: oid(doc._id), name: doc.name, status: doc.status };
};

export const updateEducation = async (
  id: string,
  input: Partial<EducationInput>
): Promise<EducationDto | null> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return null;
    try {
      return toEducationDto(await repo.updateEducation(n, input));
    } catch {
      return null;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CustomerEducation.findByIdAndUpdate(id, { $set: input }, { new: true }).lean();
  return doc ? { _id: oid(doc._id), name: doc.name, status: doc.status } : null;
};

export const deleteEducation = async (id: string): Promise<boolean> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return false;
    try {
      await repo.deleteEducation(n);
      return true;
    } catch {
      return false;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  return !!(await CustomerEducation.findByIdAndDelete(id));
};

// ─── Target Goals ────────────────────────────────────────────────────────────
export const listTargetGoals = async (opts?: {
  activeOnly?: boolean;
}): Promise<TargetGoalDto[]> => {
  if (isMysql()) {
    const rows = await repo.listTargetGoals(opts);
    return rows.map(toTargetGoalDto);
  }
  const filter: Record<string, unknown> = {};
  if (opts?.activeOnly) filter.active = true;
  const docs = await CustomerTargetGoal.find(filter).sort({ name: 1 }).lean();
  return docs.map((d) => ({ _id: oid(d._id), name: d.name, image: d.image, active: d.active }));
};

export const createTargetGoal = async (input: TargetGoalInput): Promise<TargetGoalDto> => {
  if (isMysql()) return toTargetGoalDto(await repo.createTargetGoal(input));
  const doc = await CustomerTargetGoal.create({ ...input, active: input.active ?? true });
  return { _id: oid(doc._id), name: doc.name, image: doc.image, active: doc.active };
};

export const updateTargetGoal = async (
  id: string,
  input: Partial<TargetGoalInput>
): Promise<TargetGoalDto | null> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return null;
    try {
      return toTargetGoalDto(await repo.updateTargetGoal(n, input));
    } catch {
      return null;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CustomerTargetGoal.findByIdAndUpdate(id, { $set: input }, { new: true }).lean();
  return doc
    ? { _id: oid(doc._id), name: doc.name, image: doc.image, active: doc.active }
    : null;
};

export const deleteTargetGoal = async (id: string): Promise<boolean> => {
  if (isMysql()) {
    const n = parseLookupId(id);
    if (!n) return false;
    try {
      await repo.deleteTargetGoal(n);
      return true;
    } catch {
      return false;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  return !!(await CustomerTargetGoal.findByIdAndDelete(id));
};
