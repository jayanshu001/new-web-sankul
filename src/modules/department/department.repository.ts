import { prisma } from "../../config/prisma";
import type {
  DepartmentCreateInput,
  DepartmentUpdateInput,
} from "./department.types";
import {
  toPrismaContactData,
  toPrismaDepartmentScalars,
} from "./department.transformer";

const withContacts = {
  contacts: { orderBy: { order: "asc" as const } },
};

export const departmentRepository = {
  /**
   * List departments (+ contacts), sorted by `order`. Optional `active` filter
   * (true/false; omit for all) and optional `skip`/`take` for pagination.
   */
  findMany: (opts?: { active?: boolean; skip?: number; take?: number }) =>
    prisma.department.findMany({
      where: opts?.active !== undefined ? { active: opts.active } : undefined,
      orderBy: { order: "asc" },
      include: withContacts,
      skip: opts?.skip,
      take: opts?.take,
    }),

  /** Count departments matching the optional `active` filter (for pagination). */
  count: (opts?: { active?: boolean }) =>
    prisma.department.count({
      where: opts?.active !== undefined ? { active: opts.active } : undefined,
    }),

  findById: (id: number) =>
    prisma.department.findUnique({ where: { id }, include: withContacts }),

  /** Create department + its contacts in one transaction. */
  create: async (input: DepartmentCreateInput) => {
    const dept = await prisma.department.create({
      data: {
        name: input.name,
        decscription: input.description,
        order: input.order ?? 0,
        active: input.active ?? true,
      },
    });
    const contacts = input.contacts ?? [];
    if (contacts.length) {
      await prisma.departmentContact.createMany({
        data: contacts.map((c, i) => ({
          ...toPrismaContactData(c, i),
          department: dept.id,
        })),
      });
    }
    return prisma.department.findUnique({
      where: { id: dept.id },
      include: withContacts,
    });
  },

  /**
   * Update department scalars; when `contacts` is provided, replace the whole
   * contact set (mirrors Mongo `$set: { contacts }` array replacement).
   */
  update: async (id: number, input: DepartmentUpdateInput) => {
    await prisma.department.update({
      where: { id },
      data: toPrismaDepartmentScalars(input),
    });

    if (input.contacts !== undefined) {
      await prisma.$transaction([
        prisma.departmentContact.deleteMany({ where: { department: id } }),
        prisma.departmentContact.createMany({
          data: input.contacts.map((c, i) => ({
            ...toPrismaContactData(c, i),
            department: id,
          })),
        }),
      ]);
    }

    return prisma.department.findUnique({ where: { id }, include: withContacts });
  },

  /** Delete department + its contacts (no DB cascade defined in the dump). */
  delete: (id: number) =>
    prisma.$transaction([
      prisma.departmentContact.deleteMany({ where: { department: id } }),
      prisma.department.delete({ where: { id } }),
    ]),
};
