import type { PackageCourseEbookPrice } from "@prisma/client";
import type { PriceDto } from "./commerce-price.types";

/**
 * `ws_package_course_ebook_price` row → DTO, shape-compatible with the Mongo
 * `PackageCourseEbookPrice` document.
 *
 * Notes:
 *  - ids are surfaced as strings to stay Mongo `_id`-shape compatible; the
 *    owner ids (package/course/ebook) are nullable and exactly one is set per
 *    row. DRIFT: the SQL columns use `0` (NOT only NULL) as the "not this owner"
 *    sentinel — 927/1353 rows mix `0`s and a real id. So `0`/null → null here,
 *    matching the Mongo `null` representation. (Verified the >0 invariant holds:
 *    no row owns more than one entity.)
 *  - `material_price` is nullable in SQL but defaults to `0` in the Mongo model,
 *    so null is coalesced to 0 here.
 *  - `duration` is passed through raw — it is in DAYS (see types.ts drift note);
 *    `endAt` computation is the subscription/write boundary's concern, not this
 *    read-only lookup's.
 */
/** Owner id → string, treating SQL's `0` sentinel as "no owner" (→ null). */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

export const toPriceDto = (row: PackageCourseEbookPrice): PriceDto => ({
  _id: String(row.id),
  packageId: ownerId(row.packageId),
  courseId: ownerId(row.courseId),
  ebookId: ownerId(row.ebookId),
  name: row.name ?? null,
  duration: row.duration,
  price: row.price,
  withMaterial: row.withMaterial,
  materialPrice: row.materialPrice ?? 0,
  isDefault: row.isDefault,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
