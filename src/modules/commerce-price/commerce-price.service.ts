/**
 * Commerce · Price service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `commerce-price` (Phase 3a). Table:
 * `ws_package_course_ebook_price` (1353 rows) — a pure, read-only plan/pricing
 * lookup. The single lowest-risk table in the commerce wave: no writes, no auth
 * fields, faithful 1:1 Prisma model.
 *
 * Built dual-path but kept flag OFF: every price consumer joins int-id catalog
 * rows (package/course/ebook) and ObjectId-id subscription/order rows, so this
 * flips together with catalog + the rest of Phase 3a in one consistent id-space
 * (the commerce-wave flip). Verify via live-DB `tsx` scripts, not HTTP, while
 * OFF. See docs/migration/COMMERCE_WAVE_SCOPE.md.
 */
import { isMysqlModule } from "../../config/migration";
import { commercePriceRepository as repo } from "./commerce-price.repository";
import { toPriceDto } from "./commerce-price.transformer";
import type { PriceDto } from "./commerce-price.types";

export const PRICE_MODULE = "commerce-price";

/** Whether the price read-path is served from MySQL. */
export const isPriceMysql = (): boolean => isMysqlModule(PRICE_MODULE);

/** Parse a string id to a positive int, else null. */
export const parsePriceId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Parse a list of string ids to positive ints, dropping invalid entries. */
export const parsePriceIds = (ids: string[]): number[] =>
  ids
    .map((id) => Number(id))
    .filter((n) => Number.isInteger(n) && n > 0);

// ── single ────────────────────────────────────────────────────────────────

/** Single plan by id (any status). Mirrors `findById`. */
export const findPriceById = async (id: number): Promise<PriceDto | null> => {
  const row = await repo.findById(id);
  return row ? toPriceDto(row) : null;
};

/** Single ACTIVE plan by id. Mirrors `findOne({_id, status:true})`. */
export const findActivePriceById = async (id: number): Promise<PriceDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? toPriceDto(row) : null;
};

/** Plans by ids. Mirrors `find({_id:{$in}})`. */
export const findPricesByIds = async (ids: number[]): Promise<PriceDto[]> => {
  const rows = await repo.findByIds(ids);
  return rows.map(toPriceDto);
};

// ── by owner ────────────────────────────────────────────────────────────────

/** Active plans for one package, ordered by duration asc. */
export const listActivePricesByPackage = async (packageId: number): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByPackage(packageId);
  return rows.map(toPriceDto);
};

/** Active plans for one course, ordered by duration asc. */
export const listActivePricesByCourse = async (courseId: number): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByCourse(courseId);
  return rows.map(toPriceDto);
};

/** Active plans for one ebook, ordered by duration asc. */
export const listActivePricesByEbook = async (ebookId: number): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByEbook(ebookId);
  return rows.map(toPriceDto);
};

/** Active plans for many packages. Mirrors `find({packageId:{$in}})`. */
export const listActivePricesByPackages = async (packageIds: number[]): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByPackages(packageIds);
  return rows.map(toPriceDto);
};

/** Active plans for many courses. */
export const listActivePricesByCourses = async (courseIds: number[]): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByCourses(courseIds);
  return rows.map(toPriceDto);
};

/** Active plans for many ebooks. Mirrors `find({ebookId:{$in}})`. */
export const listActivePricesByEbooks = async (ebookIds: number[]): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByEbooks(ebookIds);
  return rows.map(toPriceDto);
};
