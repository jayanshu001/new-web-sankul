// Search history: record, list and clear a customer's recent searches.
import * as repo from "./client-search-history.repository";
import * as transformer from "./client-search-history.transformer";
import { SEARCH_HISTORY_LIMIT, type SearchHistoryDto } from "./client-search-history.types";

// Lowercased so dedupe is case-insensitive regardless of column collation.
const normalize = (raw: string): string =>
  (raw || "").trim().replace(/\s+/g, " ").toLowerCase();

/** Safe to call fire-and-forget: invalid input is a no-op. Trims to the newest N afterwards. */
export const record = async (customerId: number | null, rawQuery: string): Promise<void> => {
  if (!customerId || !Number.isInteger(customerId)) return;
  const query = normalize(rawQuery);
  // Mirror the search endpoint's min-length rule — don't store 1-char noise.
  if (query.length < 2) return;
  if (query.length > 255) return;

  const now = new Date();
  await repo.upsertSearch(customerId, query, now);

  const keepIds = await repo.listKeepIds(customerId, SEARCH_HISTORY_LIMIT);
  if (keepIds.length >= SEARCH_HISTORY_LIMIT) {
    await repo.deleteOverflow(customerId, keepIds);
  }
};

export const list = async (customerId: number): Promise<SearchHistoryDto[]> => {
  const rows = await repo.listRecent(customerId, SEARCH_HISTORY_LIMIT);
  return transformer.toDtoList(rows);
};

export const listPaged = async (
  customerId: number,
  search: string | undefined,
  skip: number,
  take: number
): Promise<{ items: SearchHistoryDto[]; total: number }> => {
  const [rows, total] = await Promise.all([
    repo.listPaged(customerId, search, skip, take),
    repo.countList(customerId, search),
  ]);
  return { items: transformer.toDtoList(rows), total };
};

export const clear = async (customerId: number): Promise<number> => {
  const { count } = await repo.clearAll(customerId);
  return count;
};

export const removeOne = async (customerId: number, id: number): Promise<boolean> => {
  const { count } = await repo.deleteOne(customerId, id);
  return count > 0;
};
