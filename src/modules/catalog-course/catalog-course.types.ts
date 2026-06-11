/**
 * Catalog · Course — MySQL (Prisma) branch types.
 *
 * Tables: `ws_course` (1 row) + `ws_course_subject_category` (1 row).
 *
 * SCOPE / DRIFT NOTES (verified against the live DDL on 2026-06-11):
 *
 *  - `ws_course.image` is NULLABLE in the DDL but the Prisma model declared it
 *    NOT NULL → fixed to `String?`. `name`, `vcategory_id`, `pc_material_id`,
 *    `featured_order` are also nullable.
 *
 *  - Columns in `ws_course` with NO Prisma mapping: `is_featured` (enum 0/1),
 *    `purchase` (enum 0/1), `featured_order` (int). The Mongo `Course` carries
 *    the conceptual equivalents `isPopular` / `isPaid` (booleans) plus Mongo-only
 *    `subtitle` + embedded `materialCategories[]`/`examCategories[]`. These SQL
 *    enums are NOT surfaced here (no consumer reads them off the migrated row);
 *    add to the Prisma model + regen if ever needed.
 *
 *  - Like package, every client course LISTING endpoint joins commerce-wave
 *    tables (PackageCourseEbookPrice plans, PackageCourseSubscription ownership)
 *    and embeds Mongo-only category groups, so the full `/client/courses`
 *    contract CANNOT be reproduced from `ws_course` alone this wave. Course
 *    reads are built dual-path but kept flag OFF and flip with the commerce wave.
 *    See docs/migration/CATALOG_MODULE_SCOPE.md.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_course_subject_category` row → DTO. Shape-compatible with the Mongo doc. */
export interface CourseSubjectCategoryDto {
  _id: string;
  title: string;
  slug: string;
  image: string;
  parent: number;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** As above, plus the active-course count (listCourseCategories contract). */
export interface CourseSubjectCategoryWithCountDto extends CourseSubjectCategoryDto {
  courseCount: number;
}

/**
 * `ws_course` row → DTO (flag OFF). Only maps columns that physically exist in
 * `ws_course`; the Mongo-only fields and all commerce joins are intentionally
 * absent (see the scope note above).
 */
export interface CourseDto {
  _id: string;
  name: string | null;
  description: string;
  image: string | null;
  shareableLink: string;
  withMaterial: string;
  withoutMaterial: string;
  level: string;
  order: number;
  status: boolean;
  courseSubjectCategoryId: string | null;
  courseEducatorId: string | null;
  videoCategoryId: string | null;
  pcMaterialId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}
