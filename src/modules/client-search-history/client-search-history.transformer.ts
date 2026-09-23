/**
 * Recent Search History — Prisma row → stable DTO. Keeps `_id` (string) for
 * shape-consistency with the rest of the client search responses.
 */
import type { SearchHistory } from "@prisma/client";
import type { SearchHistoryDto } from "./client-search-history.types";

export const toDto = (row: SearchHistory): SearchHistoryDto => ({
  _id: String(row.id),
  id: row.id,
  query: row.query,
  createdAt: row.createdAt,
});

export const toDtoList = (rows: SearchHistory[]): SearchHistoryDto[] => rows.map(toDto);
