// Search history: row to DTO mapping (response shape is frozen).
import type { SearchHistory } from "@prisma/client";
import type { SearchHistoryDto } from "./client-search-history.types";

export const toDto = (row: SearchHistory): SearchHistoryDto => ({
  _id: String(row.id),
  id: row.id,
  query: row.query,
  createdAt: row.createdAt,
});

export const toDtoList = (rows: SearchHistory[]): SearchHistoryDto[] => rows.map(toDto);
