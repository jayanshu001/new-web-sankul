export interface SearchHistoryDto {
  _id: string;
  id: number;
  query: string;
  createdAt: Date;
}

// Max recent searches retained per customer; older rows are trimmed on write.
export const SEARCH_HISTORY_LIMIT = 10;
