import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type {
  CareerApplicationCreateInput,
  CareerApplicationStatus,
  CareerOpeningCreateInput,
  CareerOpeningUpdateInput,
} from "./careers.types";

const openingWhere = (opts: { search?: string; status?: boolean }) => ({
  ...(buildPrismaSearch(opts.search, ["title", "department", "location"]) ?? {}),
  ...(opts.status !== undefined ? { status: opts.status } : {}),
});

export const careersRepository = {
  // ── openings: admin ──────────────────────────────────────────────────────
  findOpeningsPage: (opts: { search?: string; status?: boolean; skip: number; take: number }) =>
    prisma.careerOpening.findMany({
      where: openingWhere(opts),
      orderBy: { id: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),
  countOpenings: (opts: { search?: string; status?: boolean }) =>
    prisma.careerOpening.count({ where: openingWhere(opts) }),
  findOpeningById: (id: bigint) => prisma.careerOpening.findUnique({ where: { id } }),
  createOpening: (input: CareerOpeningCreateInput) =>
    prisma.careerOpening.create({
      data: {
        title: input.title,
        department: input.department,
        location: input.location,
        jobType: input.jobType ?? "full_time",
        experienceLevel: input.experienceLevel ?? "any",
        description: input.description,
        requirements: input.requirements,
        minSalary: input.minSalary,
        maxSalary: input.maxSalary,
        vacancies: input.vacancies ?? 1,
        lastDate: input.lastDate,
        status: input.status ?? true,
      },
    }),
  updateOpening: (id: bigint, input: CareerOpeningUpdateInput) =>
    prisma.careerOpening.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.department !== undefined ? { department: input.department } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.jobType !== undefined ? { jobType: input.jobType } : {}),
        ...(input.experienceLevel !== undefined ? { experienceLevel: input.experienceLevel } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
        ...(input.minSalary !== undefined ? { minSalary: input.minSalary } : {}),
        ...(input.maxSalary !== undefined ? { maxSalary: input.maxSalary } : {}),
        ...(input.vacancies !== undefined ? { vacancies: input.vacancies } : {}),
        ...(input.lastDate !== undefined ? { lastDate: input.lastDate } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    }),
  deleteOpening: (id: bigint) => prisma.careerOpening.delete({ where: { id } }),

  // ── openings: public (active only) — mirrors legacy `current-openings` ────
  findActiveOpenings: () =>
    prisma.careerOpening.findMany({
      where: { status: true },
      orderBy: { id: "desc" },
    }),

  // ── applications: admin ──────────────────────────────────────────────────
  findApplicationsPage: (opts: {
    openingId?: bigint;
    status?: CareerApplicationStatus;
    skip: number;
    take: number;
  }) =>
    prisma.careerApplication.findMany({
      where: {
        ...(opts.openingId !== undefined ? { openingId: opts.openingId } : {}),
        ...(opts.status !== undefined ? { status: opts.status } : {}),
      },
      orderBy: { id: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),
  countApplications: (opts: { openingId?: bigint; status?: CareerApplicationStatus }) =>
    prisma.careerApplication.count({
      where: {
        ...(opts.openingId !== undefined ? { openingId: opts.openingId } : {}),
        ...(opts.status !== undefined ? { status: opts.status } : {}),
      },
    }),
  findApplicationById: (id: bigint) => prisma.careerApplication.findUnique({ where: { id } }),
  updateApplicationStatus: (id: bigint, status: CareerApplicationStatus) =>
    prisma.careerApplication.update({ where: { id }, data: { status } }),

  // ── applications: public submit ──────────────────────────────────────────
  createApplication: (input: CareerApplicationCreateInput) =>
    prisma.careerApplication.create({
      data: {
        openingId: input.openingId ?? undefined,
        jobTitle: input.jobTitle ?? undefined,
        fullName: input.fullName,
        email: input.email ?? undefined,
        contactNumber: input.contactNumber,
        age: input.age,
        gender: input.gender,
        address: input.address,
        experienceLevel: input.experienceLevel,
        lastCompany: input.lastCompany ?? undefined,
        currentSalary: input.currentSalary ?? undefined,
        expectedSalary: input.expectedSalary,
        reason: input.reason ?? undefined,
      },
    }),
};
