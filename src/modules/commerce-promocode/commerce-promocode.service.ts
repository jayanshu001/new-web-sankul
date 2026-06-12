/**
 * Commerce · Promocode (READ) service — dual-path (MySQL/Prisma ↔ Mongo).
 *
 * Module key: `commerce-promocode` (Phase 3a, READ-ONLY). Tables:
 * `ws_promocode` (2) + `ws_promoted_package_course_ebook` (5).
 *
 * ⚠ SQL-FAITHFUL ONLY: the client `applyPromocode`/`listPromocodes` paths read
 * the Mongo `appliesTo`/`discountValue` model, which these SQL tables do NOT
 * carry (the SQL discount is a per-plan promoter/customer % split). So this
 * module is built dual-path but kept **flag OFF** — it cannot serve the client
 * promocode contract this wave; the appliesTo reconciliation is a later effort.
 * See commerce-promocode.types.ts for the full divergence note.
 *
 * Flips with catalog + the rest of 3a (int id-space). Verify via live-DB tsx.
 */
import { isMysqlModule } from "../../config/migration";
import { commercePromocodeRepository as repo } from "./commerce-promocode.repository";
import { toPromocodeDto, toPromotedPlanDto } from "./commerce-promocode.transformer";
import type { PromocodeDto, PromotedPlanDto } from "./commerce-promocode.types";

export const PROMOCODE_MODULE = "commerce-promocode";

/** Whether the promocode read-path is served from MySQL. */
export const isPromocodeMysql = (): boolean => isMysqlModule(PROMOCODE_MODULE);

/** Parse a string id to a positive int, else null. */
export const parsePromocodeId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Single promocode by id (with promoted plans). */
export const findPromocodeById = async (id: number): Promise<PromocodeDto | null> => {
  const row = await repo.findById(id);
  return row ? toPromocodeDto(row) : null;
};

/**
 * Single VALID promocode by code (status + within window), with promoted plans.
 * The code is uppercased to mirror the Mongo path (`code.toUpperCase()`).
 */
export const findValidPromocodeByCode = async (
  code: string,
  now: Date = new Date()
): Promise<PromocodeDto | null> => {
  const row = await repo.findValidByCode(code.trim().toUpperCase(), now);
  return row ? toPromocodeDto(row) : null;
};

/** Active public promocodes within their window (paginated). */
export const listActivePublicPromocodes = async (
  opts?: { skip?: number; take?: number },
  now: Date = new Date()
): Promise<PromocodeDto[]> => {
  const rows = await repo.listActivePublic(now, opts);
  return rows.map((r) => toPromocodeDto(r));
};

/** Count of active public promocodes within their window (pagination total). */
export const countActivePublicPromocodes = async (
  now: Date = new Date()
): Promise<number> => repo.countActivePublic(now);

/** The promoted-plan rows for a promocode (per-plan % split). */
export const listPromotedPlans = async (promocodeId: number): Promise<PromotedPlanDto[]> => {
  const rows = await repo.listPromotedPlans(promocodeId);
  return rows.map(toPromotedPlanDto);
};
