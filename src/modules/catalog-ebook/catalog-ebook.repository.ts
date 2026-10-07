// Ebook catalog: Prisma queries.
import { prisma } from "../../config/prisma";
import type { EBookLanguage } from "@prisma/client";
import { buildPrismaSearch } from "../../utils/searchFilter";

/** Shared by the listing and its count so the page total matches the rows. */
const activeWhere = (opts?: { search?: string; language?: EBookLanguage }) => ({
  active: true,
  ...(opts?.language ? { language: opts.language } : {}),
  ...(buildPrismaSearch(opts?.search, ["name", "author"]) ?? {}),
});

export const catalogEbookRepository = {
  findActiveById: (id: number) =>
    prisma.eBook.findFirst({ where: { id, active: true } }),

  findById: (id: number) =>
    prisma.eBook.findUnique({ where: { id } }),

  listActive: (opts?: { search?: string; language?: EBookLanguage; skip?: number; take?: number }) =>
    prisma.eBook.findMany({
      where: activeWhere(opts),
      orderBy: [{ orderby: "asc" }, { createdAt: "asc" }],
      ...(opts?.skip != null ? { skip: opts.skip } : {}),
      ...(opts?.take != null ? { take: opts.take } : {}),
    }),

  countActive: (opts?: { search?: string; language?: EBookLanguage }) =>
    prisma.eBook.count({ where: activeWhere(opts) }),

  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.eBook.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
};
