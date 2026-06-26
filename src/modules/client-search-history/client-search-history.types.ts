/**
 * Recent Search History — DTO/input types for the client global-search history.
 * The stable API shape returned to the app (Mongo-style `_id` string preserved
 * for cross-backend consistency with the rest of the search surface).
 */

export interface SearchHistoryDto {
  _id: string;
  id: number;
  query: string;
  createdAt: Date;
}

// Max number of recent searches retained per customer. Anything older than the
// newest N is trimmed on write so the list never grows past this.
export const SEARCH_HISTORY_LIMIT = 10;
