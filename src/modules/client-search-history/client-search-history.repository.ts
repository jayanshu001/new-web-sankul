// Search history: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

// Re-searching an existing term refreshes created_at (move-to-top) instead of inserting a duplicate.
export const upsertSearch = (customerId: number, query: string, now: Date) =>
  prisma.searchHistory.upsert({
    where: { uq_search_history_customer_query: { customerId, query } },
    create: { customerId, query, createdAt: now },
    update: { createdAt: now },
  });

export const listRecent = (customerId: number, take: number) =>
  prisma.searchHistory.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take,
  });

export const listPaged = (customerId: number, search: string | undefined, skip: number, take: number) =>
  prisma.searchHistory.findMany({
    where: { customerId, ...(buildPrismaSearch(search, ["query"]) ?? {}) },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });

export const countList = (customerId: number, search: string | undefined) =>
  prisma.searchHistory.count({
    where: { customerId, ...(buildPrismaSearch(search, ["query"]) ?? {}) },
  });

export const listKeepIds = async (customerId: number, keep: number): Promise<number[]> => {
  const rows = await prisma.searchHistory.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: keep,
    select: { id: true },
  });
  return rows.map((r) => r.id);
};

export const deleteOverflow = (customerId: number, keepIds: number[]) =>
  prisma.searchHistory.deleteMany({
    where: { customerId, id: { notIn: keepIds.length ? keepIds : [0] } },
  });

export const clearAll = (customerId: number) =>
  prisma.searchHistory.deleteMany({ where: { customerId } });

// Scoped to the customer so one user cannot delete another's row.
export const deleteOne = (customerId: number, id: number) =>
  prisma.searchHistory.deleteMany({ where: { id, customerId } });
