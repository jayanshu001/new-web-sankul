import { prisma } from "../../config/prisma";
import type { FaqCategory, FaqCreateInput, FaqUpdateInput } from "./faq.types";
import { toPrismaFaqCreate, toPrismaFaqUpdate } from "./faq.transformer";

export type FaqListOpts = {
  type?: FaqCategory;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
};

// Whitelist of sortable columns (DTO key → DB column).
const FAQ_SORT_COLUMNS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  question: "question",
};

const buildFaqWhere = (opts: FaqListOpts) => {
  const where: Record<string, unknown> = {};
  if (opts.type) where.type = opts.type;
  const q = opts.search?.trim();
  if (q) where.OR = [{ question: { contains: q } }, { answer: { contains: q } }];
  return where;
};

export const faqRepository = {
  findMany: (opts?: { type?: FaqCategory }) =>
    prisma.fAQ.findMany({
      where: opts?.type ? { type: opts.type } : undefined,
      orderBy: { created_at: "asc" },
    }),

  /** Admin paginated + search list. */
  findPage: (opts: FaqListOpts) =>
    prisma.fAQ.findMany({
      where: buildFaqWhere(opts),
      orderBy: { [FAQ_SORT_COLUMNS[opts.sortBy ?? ""] ?? "created_at"]: opts.sortDir ?? "asc" },
      ...(opts.skip != null ? { skip: opts.skip } : {}),
      ...(opts.take != null ? { take: opts.take } : {}),
    }),

  count: (opts: FaqListOpts) => prisma.fAQ.count({ where: buildFaqWhere(opts) }),

  findById: (id: number) => prisma.fAQ.findUnique({ where: { id } }),

  create: (input: FaqCreateInput) =>
    prisma.fAQ.create({ data: toPrismaFaqCreate(input) }),

  update: (id: number, input: FaqUpdateInput) =>
    prisma.fAQ.update({ where: { id }, data: toPrismaFaqUpdate(input) }),

  delete: (id: number) => prisma.fAQ.delete({ where: { id } }),

  countByType: (type: FaqCategory) => prisma.fAQ.count({ where: { type } }),
};
