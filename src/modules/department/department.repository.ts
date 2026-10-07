// Departments: Prisma queries for departments and their contacts.
import { prisma } from "../../config/prisma";
import type {
  DepartmentCreateInput,
  DepartmentUpdateInput,
} from "./department.types";
import { nextOrder } from "../../utils/listOrdering";
import {
  toPrismaContactData,
  toPrismaDepartmentScalars,
} from "./department.transformer";

// No created_at on these tables, so `id ASC` stands in for the catalog tie-break.
const withContacts = {
  contacts: { orderBy: [{ order: "asc" as const }, { id: "asc" as const }] },
};

export const departmentRepository = {
  findMany: (opts?: { active?: boolean; skip?: number; take?: number; recency?: boolean }) =>
    prisma.department.findMany({
      where: opts?.active !== undefined ? { active: opts.active } : undefined,
      // `recency` is admin-only (utils/listOrdering); the client contact-us reader
      // keeps its curated `order ASC`. No created_at, so autoincrement `id DESC`.
      orderBy: opts?.recency ? [{ id: "desc" }] : [{ order: "asc" }, { id: "asc" }],
      include: withContacts,
      skip: opts?.skip,
      take: opts?.take,
    }),

  count: (opts?: { active?: boolean }) =>
    prisma.department.count({
      where: opts?.active !== undefined ? { active: opts.active } : undefined,
    }),

  findById: (id: number) =>
    prisma.department.findUnique({ where: { id }, include: withContacts }),

  create: async (input: DepartmentCreateInput) => {
    // No explicit order → previous row + 1 (see utils/listOrdering).
    const order = input.order ?? nextOrder((await prisma.department.findFirst({ orderBy: { id: "desc" }, select: { order: true } }))?.order);
    const dept = await prisma.department.create({
      data: {
        name: input.name,
        decscription: input.description,
        order,
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

  /** When `contacts` is provided, the whole contact set is replaced. */
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

  /** Deletes contacts explicitly: no DB cascade. */
  delete: (id: number) =>
    prisma.$transaction([
      prisma.departmentContact.deleteMany({ where: { department: id } }),
      prisma.department.delete({ where: { id } }),
    ]),
};
