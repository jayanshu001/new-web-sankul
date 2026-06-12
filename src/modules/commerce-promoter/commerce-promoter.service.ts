/**
 * Commerce · Promoter (READ) service — dual-path (MySQL/Prisma ↔ Mongo).
 *
 * Module key: `commerce-promoter` (Phase 3a, READ-ONLY). Table: `ws_promoter`
 * (114 rows) — the promocode owner master. Read-only: surfaces the public
 * master fields (never `password`) for hydrating promocode owners.
 *
 * Built dual-path but kept flag OFF: promoter ids are int (MySQL) vs ObjectId
 * (Mongo) and join the still-Mongo promocode/subscription consumers. Flips with
 * catalog + the rest of 3a in one consistent int id-space. Verify via live-DB
 * tsx, not HTTP, while OFF.
 */
import { isMysqlModule } from "../../config/migration";
import { commercePromoterRepository as repo } from "./commerce-promoter.repository";
import { toPromoterDto } from "./commerce-promoter.transformer";
import type { PromoterDto } from "./commerce-promoter.types";

export const PROMOTER_MODULE = "commerce-promoter";

/** Whether the promoter read-path is served from MySQL. */
export const isPromoterMysql = (): boolean => isMysqlModule(PROMOTER_MODULE);

/** Parse a string id to a positive int, else null. */
export const parsePromoterId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Parse a list of string ids to positive ints, dropping invalid entries. */
export const parsePromoterIds = (ids: string[]): number[] =>
  ids.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0);

export const findPromoterById = async (id: number): Promise<PromoterDto | null> => {
  const row = await repo.findById(id);
  return row ? toPromoterDto(row) : null;
};

/** Single ACTIVE (status + not-deleted) promoter. */
export const findActivePromoterById = async (id: number): Promise<PromoterDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? toPromoterDto(row) : null;
};

/** Promoters by ids (bulk owner hydration). */
export const findPromotersByIds = async (ids: number[]): Promise<PromoterDto[]> => {
  const rows = await repo.findByIds(ids);
  return rows.map(toPromoterDto);
};

/** Active promoters, ordered by name. Optional name/email search. */
export const listActivePromoters = async (search?: string): Promise<PromoterDto[]> => {
  const rows = await repo.listActive({ search: search?.trim() || undefined });
  return rows.map(toPromoterDto);
};
