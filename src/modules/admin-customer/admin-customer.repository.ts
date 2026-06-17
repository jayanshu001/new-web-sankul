import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

const lookupInclude = {
  state: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  education: { select: { id: true, name: true } },
} satisfies Prisma.CustomerInclude;

/** Shared WHERE builder so list + count stay in lockstep. */
const buildWhere = (opts: {
  search?: string;
  status?: boolean;
  stateId?: number;
  districtId?: number;
  fromDate?: Date;
  toDate?: Date;
}): Prisma.CustomerWhereInput => {
  const where: Prisma.CustomerWhereInput = { isAccountDeleted: false };
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [
      { fullName: { contains: q } },
      { phoneNumber: { contains: q } },
      { emailAddress: { contains: q } },
    ];
  }
  if (opts.status !== undefined) where.status = opts.status;
  if (opts.stateId !== undefined) where.stateId = opts.stateId;
  if (opts.districtId !== undefined) where.districtId = opts.districtId;
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  return where;
};

export const adminCustomerRepository = {
  list: (opts: {
    search?: string;
    status?: boolean;
    stateId?: number;
    districtId?: number;
    fromDate?: Date;
    toDate?: Date;
    skip: number;
    take: number;
  }) =>
    prisma.customer.findMany({
      where: buildWhere(opts),
      include: lookupInclude,
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),

  count: (opts: {
    search?: string;
    status?: boolean;
    stateId?: number;
    districtId?: number;
    fromDate?: Date;
    toDate?: Date;
  }) => prisma.customer.count({ where: buildWhere(opts) }),

  findById: (id: number) =>
    prisma.customer.findFirst({
      where: { id, isAccountDeleted: false },
      include: lookupInclude,
    }),

  /** Existence checks for unique phone / email (excluding a given id). */
  phoneInUse: (phone: string, exceptId?: number) =>
    prisma.customer.findFirst({
      where: {
        phoneNumber: phone,
        isAccountDeleted: false,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    }),

  emailInUse: (email: string, exceptId?: number) =>
    prisma.customer.findFirst({
      where: {
        emailAddress: email,
        isAccountDeleted: false,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    }),

  create: (data: Prisma.CustomerCreateInput) =>
    prisma.customer.create({ data, include: lookupInclude }),

  createUnchecked: (data: Prisma.CustomerUncheckedCreateInput) =>
    prisma.customer.create({ data, include: lookupInclude }),

  update: (id: number, data: Prisma.CustomerUncheckedUpdateInput) =>
    prisma.customer.update({ where: { id }, data, include: lookupInclude }),

  /** Soft delete: keep the row, mark deleted + disabled. */
  softDelete: (id: number) =>
    prisma.customer.update({
      where: { id },
      data: { isAccountDeleted: true, status: false, updatedAt: new Date() },
    }),

  setStatus: (id: number, status: boolean) =>
    prisma.customer.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    }),

  // ─── Pre-requisites (lookups) ────────────────────────────────────────────
  listStates: () =>
    prisma.customerState.findMany({
      where: { active: true },
      select: { id: true, name: true, state_code: true },
      orderBy: { name: "asc" },
    }),

  listEducations: () =>
    prisma.customerEducation.findMany({
      where: { status: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),

  listDistrictsByState: (stateId: number) =>
    prisma.customerDistict.findMany({
      where: { stateId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
};
