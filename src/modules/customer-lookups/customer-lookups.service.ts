import { customerLookupsRepository as repo } from "./customer-lookups.repository";
import {
  toStateDto,
  toDistrictDto,
  toEducationDto,
  toTargetGoalDto,
} from "./customer-lookups.transformer";
// /address/cities is sourced from districts (ws_customer_distict) but must keep
// the exact offline-city response contract — reuse that module's transformer/type.
import { toCityDto } from "../offline-city/offline-city.transformer";
import type { CityDto } from "../offline-city/offline-city.types";
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

// Map a district row (± included state) into the offline-city response contract.
// Districts have no image/order/timestamps → default (image "", order 0, null);
// `status` ← `active`; parent state populates `stateId`. Reuses offline-city's
// `toCityDto` so the JSON stays byte-identical to the old city shape.
const districtToCity = (d: {
  id: number;
  name: string;
  active: boolean;
  state?: { id: number; name: string; state_code: string } | null;
}): CityDto =>
  toCityDto({
    id: d.id,
    name: d.name,
    image: "",
    status: d.active,
    order: 0,
    createdAt: null,
    updatedAt: null,
    State: d.state
      ? { id: d.state.id, name: d.state.name, state_code: d.state.state_code }
      : null,
  });

/**
 * Active districts (ws_customer_distict) mapped into the offline-city response
 * contract — backs GET /client/address/cities. Conditions match the old city
 * list: active-only, name search, optional state scope, name order.
 */
export const listActiveCitiesFromDistricts = async (
  search?: string,
  stateId?: number
): Promise<CityDto[]> => {
  const rows = await repo.listActiveDistricts({ search: search?.trim() || undefined, stateId });
  return rows.map(districtToCity);
};

// ─── Districts as admin "cities" (/admin/address/cities → ws_customer_distict) ──
// Full CRUD in the offline-city response contract. `image`/`order` are ignored
// (no district columns); `stateId` is REQUIRED on create (district FK NOT NULL).
type CityEnvelope = { ok: true; data: CityDto } | { ok: false; status: number; message: string };
type CityDeleteEnvelope = { ok: true } | { ok: false; status: number; message: string };

export const listCityDistrictsAdmin = async (opts?: {
  status?: boolean;
  stateId?: number;
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ data: CityDto[]; total: number }> => {
  const [rows, total] = await Promise.all([repo.listAdminDistricts(opts), repo.countAdminDistricts(opts)]);
  return { data: rows.map(districtToCity), total };
};

export const getCityDistrictAdmin = async (id: number): Promise<CityDto | null> => {
  const row = await repo.findDistrictWithState(id);
  return row ? districtToCity(row) : null;
};

export const createCityDistrict = async (input: {
  name: string;
  stateId: number;
  status?: boolean;
}): Promise<CityEnvelope> => {
  // Parent state must exist (district FK NOT NULL).
  if (!(await repo.findState(input.stateId))) return { ok: false, status: 400, message: "Invalid stateId." };
  const row = await repo.createDistrictWithState({ name: input.name, stateId: input.stateId, active: input.status ?? true });
  return { ok: true, data: districtToCity(row) };
};

export const updateCityDistrict = async (
  id: number,
  input: { name?: string; stateId?: number; status?: boolean }
): Promise<CityEnvelope> => {
  if (!(await repo.findDistrict(id))) return { ok: false, status: 404, message: "City not found." };
  if (input.stateId !== undefined && !(await repo.findState(input.stateId)))
    return { ok: false, status: 400, message: "Invalid stateId." };
  const data: { name?: string; stateId?: number; active?: boolean } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.stateId !== undefined) data.stateId = input.stateId;
  if (input.status !== undefined) data.active = input.status;
  const row = await repo.updateDistrictWithState(id, data);
  return { ok: true, data: districtToCity(row) };
};

export const deleteCityDistrict = async (id: number): Promise<CityDeleteEnvelope> => {
  if (!(await repo.findDistrict(id))) return { ok: false, status: 404, message: "City not found." };
  const refs = await repo.countCustomersInDistrict(id);
  if (refs > 0) return { ok: false, status: 409, message: `Cannot delete — ${refs} customer(s) reference this city.` };
  await repo.deleteDistrict(id);
  return { ok: true };
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
