/**
 * Catalog · Package — MySQL (Prisma) branch types.
 *
 * Tables: `ws_package_type` (Phase A, enabled) and `ws_package` (Phase B, built
 * but flag OFF).
 *
 * SCOPE / DRIFT NOTES (verified against the live DDL on 2026-06-11):
 *
 *  - `ws_package_type` has ONLY `{id, name, created_at, updated_at}`. The Mongo
 *    `PackageType` model additionally carries `order` + `active`, which the
 *    `listPackageTypes` endpoint filters/sorts on. The SQL table has neither, so
 *    the MySQL branch treats every row as active and synthesizes `order: 0` to
 *    keep the response JSON shape identical to the Mongo path.
 *
 *  - `ws_package` is a STRUCTURAL SUBSET of the Mongo `ws_packages` document.
 *    The Mongo model carries catalog fields that DO NOT EXIST in the SQL table:
 *    `subtitle, isPaid, isSmartCourse, isPlannerCourse, goalId, goalLabelId,
 *    examCountdown*, packageCategoryId, specificSubjects[], materialCategories[],
 *    examCategories[], withMaterialText/withoutMaterialText`. Additionally every
 *    client package endpoint joins commerce-wave tables (PackageCourseEbookPrice
 *    plans, PackageCourseSubscription ownership, PromoCode, PackageChat) that are
 *    OUT of catalog scope. Therefore the full `/client/packages` contract CANNOT
 *    be reproduced from `ws_package` alone this wave — `ws_package` reads are
 *    built dual-path but kept flag OFF and flip with the commerce wave.
 *    See docs/migration/CATALOG_MODULE_SCOPE.md.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_package_type` row → DTO. Shape-compatible with the Mongo PackageType. */
export interface PackageTypeDto {
  _id: string;
  name: string;
  /** Synthesized — `ws_package_type` has no `order` column (Mongo had one). */
  order: number;
  /** Synthesized `true` — `ws_package_type` has no `status`/`active` column. */
  active: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * `ws_package` row → DTO (Phase B, flag OFF). Only the columns that physically
 * exist in `ws_package` are mapped; the Mongo-only catalog fields and all
 * commerce joins are intentionally absent (see the scope note above).
 */
export interface PackageDto {
  _id: string;
  name: string;
  description: string;
  image: string;
  shareableLink: string | null;
  withMaterial: string;
  withoutMaterial: string;
  packageTypeId: string | null;
  examId: string | null;
  educatorId: string | null;
  pcMaterialId: string | null;
  order: number;
  active: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
