// Book catalog: Prisma queries.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import type { ListBooksOptions } from "./catalog-book.types";
import { buildPrismaSearch } from "../../utils/searchFilter";

const buildWhere = (opts?: ListBooksOptions): Prisma.BookWhereInput => {
  const where: Prisma.BookWhereInput = { active: true };
  if (opts?.language) where.language = opts.language;
  // Type buckets are mutually exclusive; "regular" means neither flag is set.
  if (opts?.type === "magazine") where.is_magazine = true;
  else if (opts?.type === "combo") where.isCombo = true;
  else if (opts?.type === "regular") { where.is_magazine = false; where.isCombo = false; }
  const search = buildPrismaSearch(opts?.search, ["name", "author"]);
  if (search) where.AND = search.AND;
  return where;
};

export const catalogBookRepository = {
  findActiveById: (id: number) =>
    prisma.book.findFirst({ where: { id, active: true } }),

  findById: (id: number) =>
    prisma.book.findUnique({ where: { id } }),

  listActive: (opts?: ListBooksOptions) =>
    prisma.book.findMany({
      where: buildWhere(opts),
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      skip: opts?.skip,
      take: opts?.take,
    }),

  countActive: (opts?: ListBooksOptions) => prisma.book.count({ where: buildWhere(opts) }),

  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.book.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
};
