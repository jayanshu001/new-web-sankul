import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the catalog · book READ branch (`ws_book`, flag OFF).
 * Active books, ordered by `order_by` then newest — mirrors the Mongo
 * `find({status:true}).sort({orderBy:1, createdAt:-1})`. Optional name/author
 * search + language filter.
 */
export const catalogBookRepository = {
  /** Single active book by id. */
  findActiveById: (id: number) =>
    prisma.book.findFirst({ where: { id, active: true } }),

  /** Single book by id (any status). */
  findById: (id: number) =>
    prisma.book.findUnique({ where: { id } }),

  /** Active books with optional name/author search + language filter. */
  listActive: (opts?: { search?: string; language?: string }) =>
    prisma.book.findMany({
      where: {
        active: true,
        ...(opts?.language ? { language: opts.language } : {}),
        ...(opts?.search
          ? {
              OR: [
                { name: { contains: opts.search } },
                { author: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ order_by: "asc" }, { created_at: "desc" }, { id: "desc" }],
    }),

  /** Books by ids (bulk hydration, e.g. purchase-history / cart). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.book.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
};
