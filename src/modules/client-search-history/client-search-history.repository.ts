/**
 * Recent Search History — Prisma calls ONLY (no business logic).
 */
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

// Upsert by (customer_id, query): re-searching an existing term refreshes its
// created_at (move-to-top / dedupe) instead of inserting a duplicate row.
export const upsertSearch = (customerId: number, query: string, now: Date) =>
  prisma.searchHistory.upsert({
    where: { uq_search_history_customer_query: { customerId, query } },
    create: { customerId, query, createdAt: now },
    update: { createdAt: now },
  });

// Newest-first list, capped at `take`.
export const listRecent = (customerId: number, take: number) =>
  prisma.searchHistory.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take,
  });

// Newest-first paginated list with optional query-text search (`skip`/`take`).
export const listPaged = (customerId: number, search: string | undefined, skip: number, take: number) =>
  prisma.searchHistory.findMany({
    where: { customerId, ...(buildPrismaSearch(search, ["query"]) ?? {}) },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });

// Total rows matching the same customer/search filter (pagination count).
export const countList = (customerId: number, search: string | undefined) =>
  prisma.searchHistory.count({
    where: { customerId, ...(buildPrismaSearch(search, ["query"]) ?? {}) },
  });

// Ids of the rows to KEEP (the newest `keep`), used to compute the overflow.
export const listKeepIds = async (customerId: number, keep: number): Promise<number[]> => {
  const rows = await prisma.searchHistory.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: keep,
    select: { id: true },
  });
  return rows.map((r) => r.id);
};

// Delete everything for this customer except the supplied ids (the overflow).
export const deleteOverflow = (customerId: number, keepIds: number[]) =>
  prisma.searchHistory.deleteMany({
    where: { customerId, id: { notIn: keepIds.length ? keepIds : [0] } },
  });

export const clearAll = (customerId: number) =>
  prisma.searchHistory.deleteMany({ where: { customerId } });

// Scoped delete: only removes the row if it belongs to this customer.
export const deleteOne = (customerId: number, id: number) =>
  prisma.searchHistory.deleteMany({ where: { id, customerId } });
