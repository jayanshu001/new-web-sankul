import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import {
  DEFAULT_EXPERIENCE_LEVEL,
  DEFAULT_JOB_TYPE,
  DEFAULT_VACANCIES,
  OPENING_SEARCH_FIELDS,
  type CareerApplicationCreateInput,
  type CareerApplicationFilter,
  type CareerApplicationListParams,
  type CareerApplicationStatus,
  type CareerOpeningCreateInput,
  type CareerOpeningFilter,
  type CareerOpeningListParams,
  type CareerOpeningUpdateInput,
} from "./careers.types";

const definedFields = <T extends object>(input: T): { [K in keyof T]?: T[K] } =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: T[K];
  };

const openingWhere = (filter: CareerOpeningFilter): Prisma.CareerOpeningWhereInput => ({
  ...(buildPrismaSearch(filter.search, [...OPENING_SEARCH_FIELDS]) ?? {}),
  ...(filter.status === undefined ? {} : { status: filter.status }),
});

const applicationWhere = (filter: CareerApplicationFilter): Prisma.CareerApplicationWhereInput => ({
  ...(filter.openingId === undefined ? {} : { openingId: filter.openingId }),
  ...(filter.status === undefined ? {} : { status: filter.status }),
});

export const careersRepository = {
  findOpeningsPage: (params: CareerOpeningListParams) =>
    prisma.careerOpening.findMany({
      where: openingWhere(params),
      orderBy: { id: "desc" },
      skip: params.skip,
      take: params.take,
    }),

  countOpenings: (filter: CareerOpeningFilter) =>
    prisma.careerOpening.count({ where: openingWhere(filter) }),

  findOpeningById: (id: bigint) => prisma.careerOpening.findUnique({ where: { id } }),

  findActiveOpenings: () =>
    prisma.careerOpening.findMany({ where: { status: true }, orderBy: { id: "desc" } }),

  createOpening: (input: CareerOpeningCreateInput) =>
    prisma.careerOpening.create({
      data: {
        ...definedFields(input),
        title: input.title,
        jobType: input.jobType ?? DEFAULT_JOB_TYPE,
        experienceLevel: input.experienceLevel ?? DEFAULT_EXPERIENCE_LEVEL,
        vacancies: input.vacancies ?? DEFAULT_VACANCIES,
        status: input.status ?? true,
      },
    }),

  updateOpening: (id: bigint, input: CareerOpeningUpdateInput) =>
    prisma.careerOpening.update({ where: { id }, data: definedFields(input) }),

  deleteOpening: (id: bigint) => prisma.careerOpening.delete({ where: { id } }),

  findApplicationsPage: (params: CareerApplicationListParams) =>
    prisma.careerApplication.findMany({
      where: applicationWhere(params),
      orderBy: { id: "desc" },
      skip: params.skip,
      take: params.take,
    }),

  countApplications: (filter: CareerApplicationFilter) =>
    prisma.careerApplication.count({ where: applicationWhere(filter) }),

  findApplicationById: (id: bigint) => prisma.careerApplication.findUnique({ where: { id } }),

  updateApplicationStatus: (id: bigint, status: CareerApplicationStatus) =>
    prisma.careerApplication.update({ where: { id }, data: { status } }),

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
