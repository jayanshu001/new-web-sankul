/**
 * Recent Search History — logic for the client global-search history.
 *
 * Behaviour:
 *  - record(): upsert the term (dedupe / move-to-top), then trim so only the
 *    newest SEARCH_HISTORY_LIMIT rows survive per customer. Older ones vanish.
 *  - list(): newest-first, capped at SEARCH_HISTORY_LIMIT.
 *
 * MySQL-only (net-new data, no Mongo legacy). The `isMysqlModule` gate is kept
 * for call-site consistency with neighbouring modules.
 */
import * as repo from "./client-search-history.repository";
import * as transformer from "./client-search-history.transformer";
import { SEARCH_HISTORY_LIMIT, type SearchHistoryDto } from "./client-search-history.types";

export const isSearchHistoryMysql = (): boolean => true;

// Normalize so "  UPSC ", "upsc", and "UPSC" all collapse to one history
// entry: trim, collapse internal whitespace, and lowercase (case-insensitive
// dedupe — independent of the column collation).
const normalize = (raw: string): string =>
  (raw || "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Record a search term for a customer. Safe to call fire-and-forget from the
 * search handler — invalid input is a no-op. Trims to the newest N afterwards.
 */
export const record = async (customerId: number | null, rawQuery: string): Promise<void> => {
  if (!customerId || !Number.isInteger(customerId)) return;
  const query = normalize(rawQuery);
  // Mirror the search endpoint's min-length rule — don't store 1-char noise.
  if (query.length < 2) return;
  if (query.length > 255) return;

  const now = new Date();
  await repo.upsertSearch(customerId, query, now);

  // Trim overflow: keep only the newest N rows for this customer.
  const keepIds = await repo.listKeepIds(customerId, SEARCH_HISTORY_LIMIT);
  if (keepIds.length >= SEARCH_HISTORY_LIMIT) {
    await repo.deleteOverflow(customerId, keepIds);
  }
};

export const list = async (customerId: number): Promise<SearchHistoryDto[]> => {
  const rows = await repo.listRecent(customerId, SEARCH_HISTORY_LIMIT);
  return transformer.toDtoList(rows);
};

export const clear = async (customerId: number): Promise<number> => {
  const { count } = await repo.clearAll(customerId);
  return count;
};

// Returns true when a row was actually deleted (i.e. it existed and was owned).
export const removeOne = async (customerId: number, id: number): Promise<boolean> => {
  const { count } = await repo.deleteOne(customerId, id);
  return count > 0;
};
