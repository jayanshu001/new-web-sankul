import { prisma } from "../../config/prisma";
import type { FaqCategory, FaqCreateInput, FaqUpdateInput } from "./faq.types";
import { toPrismaFaqCreate, toPrismaFaqUpdate } from "./faq.transformer";

export const faqRepository = {
  findMany: (opts?: { type?: FaqCategory }) =>
    prisma.fAQ.findMany({
      where: opts?.type ? { type: opts.type } : undefined,
      orderBy: { created_at: "asc" },
    }),

  findById: (id: number) => prisma.fAQ.findUnique({ where: { id } }),

  create: (input: FaqCreateInput) =>
    prisma.fAQ.create({ data: toPrismaFaqCreate(input) }),

  update: (id: number, input: FaqUpdateInput) =>
    prisma.fAQ.update({ where: { id }, data: toPrismaFaqUpdate(input) }),

  delete: (id: number) => prisma.fAQ.delete({ where: { id } }),

  countByType: (type: FaqCategory) => prisma.fAQ.count({ where: { type } }),
};
