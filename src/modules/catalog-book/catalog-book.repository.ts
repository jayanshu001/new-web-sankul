import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import type { ListBooksOptions } from "./catalog-book.types";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Prisma persistence for the catalog · book READ branch (`ws_book`, flag OFF).
 * Active books, ordered by the admin display order then oldest-first
 * (`order_by ASC, created_at ASC`) — the standard client catalog ordering.
 * Optional name/author search + language filter + `type` bucket
 * (magazine/combo/regular) + paging.
 */
const buildWhere = (opts?: ListBooksOptions): Prisma.BookWhereInput => {
  const where: Prisma.BookWhereInput = { active: true };
  if (opts?.language) where.language = opts.language;
  // type buckets are mutually exclusive: magazine=is_magazine, combo=isCombo,
  // regular=neither flag set.
  if (opts?.type === "magazine") where.is_magazine = true;
  else if (opts?.type === "combo") where.isCombo = true;
  else if (opts?.type === "regular") { where.is_magazine = false; where.isCombo = false; }
  const search = buildPrismaSearch(opts?.search, ["name", "author"]);
  if (search) where.AND = search.AND;
  return where;
};

export const catalogBookRepository = {
  /** Single active book by id. */
  findActiveById: (id: number) =>
    prisma.book.findFirst({ where: { id, active: true } }),

  /** Single book by id (any status). */
  findById: (id: number) =>
    prisma.book.findUnique({ where: { id } }),

  /** Active books for one page (search + language + type), ordered like Mongo. */
  listActive: (opts?: ListBooksOptions) =>
    prisma.book.findMany({
      where: buildWhere(opts),
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      skip: opts?.skip,
      take: opts?.take,
    }),

  /** Total active books matching the same filter (for pagination). */
  countActive: (opts?: ListBooksOptions) => prisma.book.count({ where: buildWhere(opts) }),

  /** Books by ids (bulk hydration, e.g. purchase-history / cart). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.book.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
};
