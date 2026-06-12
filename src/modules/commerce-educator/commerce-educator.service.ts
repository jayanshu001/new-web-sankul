/**
 * Commerce · Educator (READ) service — dual-path (MySQL/Prisma ↔ Mongo).
 *
 * Module key: `commerce-educator` (Phase 3a, READ-ONLY). Table:
 * `ws_course_educator` (56 rows) — a full entity (not a join table), read here
 * as the public educator master. Surfaces the master fields (never `password`)
 * + a lightweight `{_id, name, image}` ref for embedding in course listings.
 *
 * Built dual-path but kept flag OFF: educator ids are int (MySQL) vs ObjectId
 * (Mongo) and join the still-Mongo course/educator consumers. Flips with catalog
 * + the rest of 3a in one consistent int id-space. Verify via live-DB tsx.
 */
import { isMysqlModule } from "../../config/migration";
import { commerceEducatorRepository as repo } from "./commerce-educator.repository";
import { toEducatorDto, toEducatorRefDto } from "./commerce-educator.transformer";
import type { EducatorDto, EducatorRefDto } from "./commerce-educator.types";

export const EDUCATOR_MODULE = "commerce-educator";

/** Whether the educator read-path is served from MySQL. */
export const isEducatorMysql = (): boolean => isMysqlModule(EDUCATOR_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseEducatorId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Parse a list of string ids to positive ints, dropping invalid entries. */
export const parseEducatorIds = (ids: string[]): number[] =>
  ids.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0);

export const findEducatorById = async (id: number): Promise<EducatorDto | null> => {
  const row = await repo.findById(id);
  return row ? toEducatorDto(row) : null;
};

/** Single ACTIVE educator (mirrors `findOne({_id, status:true})`). */
export const findActiveEducatorById = async (id: number): Promise<EducatorDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? toEducatorDto(row) : null;
};

/** Educators by ids (bulk hydration of course `courseEducatorId`). */
export const findEducatorsByIds = async (ids: number[]): Promise<EducatorDto[]> => {
  const rows = await repo.findByIds(ids);
  return rows.map(toEducatorDto);
};

/** Active educators, ordered by name. Optional name search. */
export const listActiveEducators = async (search?: string): Promise<EducatorDto[]> => {
  const rows = await repo.listActive({ search: search?.trim() || undefined });
  return rows.map(toEducatorDto);
};

/** Lightweight `{_id, name, image}` ref for embedding in a course listing. */
export const findEducatorRefById = async (id: number): Promise<EducatorRefDto | null> => {
  const row = await repo.findRefById(id);
  return row ? toEducatorRefDto(row) : null;
};
