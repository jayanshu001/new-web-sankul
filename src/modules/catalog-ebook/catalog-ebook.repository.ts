import { prisma } from "../../config/prisma";
import type { EBookLanguage } from "@prisma/client";

/**
 * Prisma persistence for the catalog · ebook READ branch (`ws_ebook`, flag OFF).
 * Active ebooks, ordered by `order_by` then newest — mirrors the Mongo
 * `find({status:true}).sort({order:1, createdAt:-1})`. Optional name/author
 * search + language filter.
 */
export const catalogEbookRepository = {
  /** Single active ebook by id. */
  findActiveById: (id: number) =>
    prisma.eBook.findFirst({ where: { id, active: true } }),

  /** Single ebook by id (any status). */
  findById: (id: number) =>
    prisma.eBook.findUnique({ where: { id } }),

  /** Active ebooks, ordered, with optional name/author search + language. */
  listActive: (opts?: { search?: string; language?: EBookLanguage }) =>
    prisma.eBook.findMany({
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
      orderBy: [{ orderby: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    }),

  /** Ebooks by ids (bulk hydration, e.g. for my-subscriptions). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.eBook.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
};
