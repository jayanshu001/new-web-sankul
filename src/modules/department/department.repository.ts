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

// ws_department / ws_department_contact carry no created_at, so the client
// catalog rule (order ASC, created_at ASC) falls back to `id ASC` here.
const withContacts = {
  contacts: { orderBy: [{ order: "asc" as const }, { id: "asc" as const }] },
};

export const departmentRepository = {
  /**
   * List departments (+ contacts), sorted by `order`. Optional `active` filter
   * (true/false; omit for all) and optional `skip`/`take` for pagination.
   */
  findMany: (opts?: { active?: boolean; skip?: number; take?: number; recency?: boolean }) =>
    prisma.department.findMany({
      where: opts?.active !== undefined ? { active: opts.active } : undefined,
      // `recency` is set only by the ADMIN list (utils/listOrdering). The client
      // contact-us reader shares this query and keeps its curated `order ASC`.
      // ws_department has NO created_at column, so `id DESC` stands in — it is
      // exactly equivalent here, the id being autoincrement.
      orderBy: opts?.recency ? [{ id: "desc" }] : [{ order: "asc" }, { id: "asc" }],
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
