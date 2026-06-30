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

export const parseLookupId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ─── States ────────────────────────────────────────────────────────────────
export const listStates = async (opts?: {
  activeOnly?: boolean;
  search?: string;
}): Promise<StateDto[]> => {
  const rows = await repo.listStates(opts);
  return rows.map(toStateDto);
};

export const createState = async (input: StateInput): Promise<StateDto> => {
  return toStateDto(await repo.createState(input));
};

export const updateState = async (
  id: string,
  input: Partial<StateInput>
): Promise<StateDto | null> => {
  const n = parseLookupId(id);
  if (!n) return null;
  try {
    return toStateDto(await repo.updateState(n, input));
  } catch {
    return null;
  }
};

export const deleteState = async (id: string): Promise<boolean> => {
  const n = parseLookupId(id);
  if (!n) return false;
  try {
    await repo.deleteState(n);
    return true;
  } catch {
    return false;
  }
};

// ─── Districts ───────────────────────────────────────────────────────────────
export const listDistrictsByState = async (
  stateId: string,
  opts?: { activeOnly?: boolean }
): Promise<DistrictDto[]> => {
  const n = parseLookupId(stateId);
  const rows = await repo.listDistricts({ stateId: n ?? undefined, activeOnly: opts?.activeOnly });
  return rows.map(toDistrictDto);
};

export const createDistrict = async (input: DistrictInput): Promise<DistrictDto> => {
  return toDistrictDto(await repo.createDistrict(input));
};

export const updateDistrict = async (
  id: string,
  input: Partial<DistrictInput>
): Promise<DistrictDto | null> => {
  const n = parseLookupId(id);
  if (!n) return null;
  try {
    return toDistrictDto(await repo.updateDistrict(n, input));
  } catch {
    return null;
  }
};

export const deleteDistrict = async (id: string): Promise<boolean> => {
  const n = parseLookupId(id);
  if (!n) return false;
  try {
    await repo.deleteDistrict(n);
    return true;
  } catch {
    return false;
  }
};

// ─── Educations ──────────────────────────────────────────────────────────────
export const listEducations = async (opts?: {
  activeOnly?: boolean;
}): Promise<EducationDto[]> => {
  const rows = await repo.listEducations(opts);
  return rows.map(toEducationDto);
};

export const createEducation = async (input: EducationInput): Promise<EducationDto> => {
  return toEducationDto(await repo.createEducation(input));
};

export const updateEducation = async (
  id: string,
  input: Partial<EducationInput>
): Promise<EducationDto | null> => {
  const n = parseLookupId(id);
  if (!n) return null;
  try {
    return toEducationDto(await repo.updateEducation(n, input));
  } catch {
    return null;
  }
};

export const deleteEducation = async (id: string): Promise<boolean> => {
  const n = parseLookupId(id);
  if (!n) return false;
  try {
    await repo.deleteEducation(n);
    return true;
  } catch {
    return false;
  }
};

// ─── Target Goals ────────────────────────────────────────────────────────────
export const listTargetGoals = async (opts?: {
  activeOnly?: boolean;
}): Promise<TargetGoalDto[]> => {
  const rows = await repo.listTargetGoals(opts);
  return rows.map(toTargetGoalDto);
};

export const createTargetGoal = async (input: TargetGoalInput): Promise<TargetGoalDto> => {
  return toTargetGoalDto(await repo.createTargetGoal(input));
};

export const updateTargetGoal = async (
  id: string,
  input: Partial<TargetGoalInput>
): Promise<TargetGoalDto | null> => {
  const n = parseLookupId(id);
  if (!n) return null;
  try {
    return toTargetGoalDto(await repo.updateTargetGoal(n, input));
  } catch {
    return null;
  }
};

export const deleteTargetGoal = async (id: string): Promise<boolean> => {
  const n = parseLookupId(id);
  if (!n) return false;
  try {
    await repo.deleteTargetGoal(n);
    return true;
  } catch {
    return false;
  }
};
