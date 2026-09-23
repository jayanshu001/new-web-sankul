import { prisma } from "../../config/prisma";
import type { EBookLanguage } from "@prisma/client";
import { buildPrismaSearch } from "../../utils/searchFilter";

/** Shared WHERE for the active-ebook listing + its count (kept identical so the page total matches the rows). */
const activeWhere = (opts?: { search?: string; language?: EBookLanguage }) => ({
  active: true,
  ...(opts?.language ? { language: opts.language } : {}),
  ...(buildPrismaSearch(opts?.search, ["name", "author"]) ?? {}),
});

/**
 * Prisma persistence for the catalog · ebook READ branch (`ws_ebook`, flag OFF).
 * Active ebooks, ordered by the admin display order then oldest-first
 * (`order_by ASC, created_at ASC`) — the standard client catalog ordering.
 * Optional name/author search + language filter.
 */
export const catalogEbookRepository = {
  /** Single active ebook by id. */
  findActiveById: (id: number) =>
    prisma.eBook.findFirst({ where: { id, active: true } }),

  /** Single ebook by id (any status). */
  findById: (id: number) =>
    prisma.eBook.findUnique({ where: { id } }),

  /** Active ebooks, ordered, with optional name/author search + language + page window. */
  listActive: (opts?: { search?: string; language?: EBookLanguage; skip?: number; take?: number }) =>
    prisma.eBook.findMany({
      where: activeWhere(opts),
      orderBy: [{ orderby: "asc" }, { createdAt: "asc" }],
      ...(opts?.skip != null ? { skip: opts.skip } : {}),
      ...(opts?.take != null ? { take: opts.take } : {}),
    }),

  /** Total active ebooks matching the same search + language filter (for pagination). */
  countActive: (opts?: { search?: string; language?: EBookLanguage }) =>
    prisma.eBook.count({ where: activeWhere(opts) }),

  /** Ebooks by ids (bulk hydration, e.g. for my-subscriptions). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.eBook.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
};
