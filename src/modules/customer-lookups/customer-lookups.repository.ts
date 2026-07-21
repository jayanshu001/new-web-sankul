import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type {
  StateInput,
  DistrictInput,
  EducationInput,
  TargetGoalInput,
} from "./customer-lookups.types";

// Shared WHERE for the admin district ("city") list + count: optional status
// (active), state filter, and name search. Mirrors the offline-city admin WHERE.
const adminDistrictWhere = (opts?: { status?: boolean; stateId?: number; search?: string }) => ({
  ...(opts?.status === undefined ? {} : { active: opts.status }),
  ...(opts?.stateId ? { stateId: opts.stateId } : {}),
  ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
});

export const customerLookupsRepository = {
  // ── States ──
  listStates: (opts?: { activeOnly?: boolean; search?: string }) =>
    prisma.customerState.findMany({
      where: {
        ...(opts?.activeOnly ? { active: true } : {}),
        ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
      },
      orderBy: { name: "asc" },
    }),
  findState: (id: number) => prisma.customerState.findUnique({ where: { id } }),
  createState: (input: StateInput) =>
    prisma.customerState.create({
      data: { name: input.name, state_code: input.stateCode, active: input.active ?? true },
    }),
  updateState: (id: number, input: Partial<StateInput>) =>
    prisma.customerState.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.stateCode !== undefined ? { state_code: input.stateCode } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    }),
  deleteState: (id: number) => prisma.customerState.delete({ where: { id } }),

  // ── Districts ──
  listDistricts: (opts?: { stateId?: number; activeOnly?: boolean }) =>
    prisma.customerDistict.findMany({
      where: {
        ...(opts?.stateId ? { stateId: opts.stateId } : {}),
        ...(opts?.activeOnly ? { active: true } : {}),
      },
      orderBy: { name: "asc" },
    }),

  // Active districts for the /address/cities dropdown (sourced from
  // ws_customer_distict). Same conditions as the offline-city list: active-only,
  // name search, optional state scope. Districts have no `order` column, so name
  // order stands in for the city (order, name) sort. Includes the parent state
  // for the populated `stateId` sub-object.
  listActiveDistricts: (opts?: { search?: string; stateId?: number }) =>
    prisma.customerDistict.findMany({
      where: {
        active: true,
        ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
        ...(opts?.stateId ? { stateId: opts.stateId } : {}),
      },
      include: { state: { select: { id: true, name: true, state_code: true } } },
      orderBy: { name: "asc" },
    }),
  findDistrict: (id: number) => prisma.customerDistict.findUnique({ where: { id } }),
  createDistrict: (input: DistrictInput) =>
    prisma.customerDistict.create({
      data: { name: input.name, stateId: Number(input.stateId), active: input.active ?? true },
    }),
  updateDistrict: (id: number, input: Partial<DistrictInput>) =>
    prisma.customerDistict.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.stateId !== undefined ? { stateId: Number(input.stateId) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    }),
  deleteDistrict: (id: number) => prisma.customerDistict.delete({ where: { id } }),

  // ── Districts as admin "cities" (/admin/address/cities → ws_customer_distict) ──
  // Admin list includes inactive; optional status + state filter + name search,
  // newest-first order (no timestamp column → PK id desc as creation proxy),
  // paginated when skip/take given. State included for the city DTO.
  listAdminDistricts: (opts?: { status?: boolean; stateId?: number; search?: string; skip?: number; take?: number }) =>
    prisma.customerDistict.findMany({
      where: adminDistrictWhere(opts),
      include: { state: { select: { id: true, name: true, state_code: true } } },
      orderBy: { id: "desc" },
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),
  countAdminDistricts: (opts?: { status?: boolean; stateId?: number; search?: string }) =>
    prisma.customerDistict.count({ where: adminDistrictWhere(opts) }),
  findDistrictWithState: (id: number) =>
    prisma.customerDistict.findUnique({
      where: { id },
      include: { state: { select: { id: true, name: true, state_code: true } } },
    }),
  createDistrictWithState: (data: { name: string; stateId: number; active: boolean }) =>
    prisma.customerDistict.create({
      data,
      include: { state: { select: { id: true, name: true, state_code: true } } },
    }),
  updateDistrictWithState: (id: number, data: { name?: string; stateId?: number; active?: boolean }) =>
    prisma.customerDistict.update({
      where: { id },
      data,
      include: { state: { select: { id: true, name: true, state_code: true } } },
    }),
  // Delete guard: districts are referenced by ws_customer.district (customer FK).
  countCustomersInDistrict: (id: number) => prisma.customer.count({ where: { districtId: id } }),

  // ── Educations ──
  listEducations: (opts?: { activeOnly?: boolean }) =>
    prisma.customerEducation.findMany({
      where: opts?.activeOnly ? { status: true } : undefined,
      orderBy: { name: "asc" },
    }),
  findEducation: (id: number) => prisma.customerEducation.findUnique({ where: { id } }),
  createEducation: (input: EducationInput) =>
    prisma.customerEducation.create({
      data: { name: input.name, status: input.status ?? true },
    }),
  updateEducation: (id: number, input: Partial<EducationInput>) =>
    prisma.customerEducation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    }),
  deleteEducation: (id: number) => prisma.customerEducation.delete({ where: { id } }),

  // ── Target Goals ──
  listTargetGoals: (opts?: { activeOnly?: boolean }) =>
    prisma.customerTargetGoal.findMany({
      where: opts?.activeOnly ? { active: true } : undefined,
      orderBy: { name: "asc" },
    }),
  findTargetGoal: (id: number) => prisma.customerTargetGoal.findUnique({ where: { id } }),
  createTargetGoal: (input: TargetGoalInput) =>
    prisma.customerTargetGoal.create({
      data: { name: input.name, image: input.image, active: input.active ?? true },
    }),
  updateTargetGoal: (id: number, input: Partial<TargetGoalInput>) =>
    prisma.customerTargetGoal.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    }),
  deleteTargetGoal: (id: number) => prisma.customerTargetGoal.delete({ where: { id } }),
};
