import { prisma } from "../../config/prisma";
import type {
  StateInput,
  DistrictInput,
  EducationInput,
  TargetGoalInput,
} from "./customer-lookups.types";

export const customerLookupsRepository = {
  // ── States ──
  listStates: (opts?: { activeOnly?: boolean; search?: string }) =>
    prisma.customerState.findMany({
      where: {
        ...(opts?.activeOnly ? { active: true } : {}),
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
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
