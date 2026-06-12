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
  /** Mongo `isPopular` ← SQL `is_featured` enum('0','1'); default false. */
  isPopular: boolean;
  /** Mongo `isPaid` ← SQL `purchase` enum('0','1'); NULL/'1' → true (Mongo default), '0' → false. */
  isPaid: boolean;
  courseSubjectCategoryId: string | null;
  courseEducatorId: string | null;
  videoCategoryId: string | null;
  pcMaterialId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Lightweight populated ref ({_id, name} or {_id, title}) on a list item. */
export interface CourseRefDto {
  _id: string;
  name?: string;
  title?: string;
}

/** One plan row split bucket (withMaterial / withoutMaterial), Mongo-shaped. */
export interface CoursePlanBuckets {
  withMaterial: unknown[];
  withoutMaterial: unknown[];
}

/**
 * A course list item as `listCoursesHandler` returns it: the course row +
 * populated educator/subject/video-category refs + plans split by material +
 * the per-customer purchase state (isPurchased / daysLeft). Mirrors the Mongo
 * `paginateCoursesWithPlans` output shape.
 */
export interface CourseListItemDto
  extends Omit<CourseDto, "courseEducatorId" | "courseSubjectCategoryId" | "videoCategoryId"> {
  courseEducatorId: CourseRefDto | string | null;
  courseSubjectCategoryId: CourseRefDto | string | null;
  videoCategoryId: CourseRefDto | string | null;
  isPurchased: boolean;
  daysLeft: number | null;
  plans: CoursePlanBuckets;
}

/** Paginated course-listing envelope (matches the Mongo handler's `{data, pagination}`). */
export interface PaginatedCourses {
  data: CourseListItemDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/** Options accepted by the paginated course listing (from the query string). */
export interface ListCoursesOptions {
  search?: string;
  isPopular?: boolean;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "ordered" | "name";
  sortOrder?: "asc" | "desc";
  /** Resolved int customer id for purchase-state (C3 boundary). */
  customerId?: number;
  /** Restrict to a subject category (listCoursesByCategory). */
  categoryId?: number;
}
