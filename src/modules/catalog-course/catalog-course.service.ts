/**
 * Catalog · Course service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Gated behind `isMysqlModule("catalog-course")` — currently **flag OFF**.
 *
 * Built dual-path but NOT enabled: like package, every client course LISTING
 * endpoint joins commerce-wave tables (PackageCourseEbookPrice plans,
 * PackageCourseSubscription ownership) and embeds Mongo-only category groups, so
 * the full `/client/courses` contract cannot be reproduced from `ws_course`
 * alone this wave. And the subject-category / course id-space is int (MySQL) vs
 * ObjectId (Mongo) — flipping any single course read while its still-Mongo
 * consumers join those ids would split the id space → broken FE. So
 * `catalog-course` flips WITH the commerce/dashboard wave (D3, mirrors package).
 * See docs/migration/CATALOG_MODULE_SCOPE.md.
 */
import { isMysqlModule } from "../../config/migration";
import { catalogCourseRepository as repo } from "./catalog-course.repository";
import {
  toCourseCategoryWithCountDto,
  toCourseDto,
} from "./catalog-course.transformer";
import type {
  CourseDto,
  CourseSubjectCategoryWithCountDto,
} from "./catalog-course.types";

export const COURSE_MODULE = "catalog-course";
export const isCourseMysql = (): boolean => isMysqlModule(COURSE_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseCourseId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── subject categories ──────────────────────────────────────────────────────

/**
 * Active subject categories each with their active-course count — matches the
 * Mongo `listCourseCategories` contract (`{...category, courseCount}`).
 */
export const listCourseCategoriesWithCounts = async (): Promise<
  CourseSubjectCategoryWithCountDto[]
> => {
  const categories = await repo.listActiveCategories();
  if (categories.length === 0) return [];

  const counts = await repo.countActiveCoursesByCategory(categories.map((c) => c.id));
  const countById = new Map<number, number>();
  for (const row of counts) {
    if (row.courseSubjectCategoryId != null) {
      countById.set(row.courseSubjectCategoryId, row._count._all);
    }
  }
  return categories.map((c) => toCourseCategoryWithCountDto(c, countById.get(c.id) ?? 0));
};

// ── courses ─────────────────────────────────────────────────────────────────

export const findCourseById = async (id: number): Promise<CourseDto | null> => {
  const row = await repo.findCourseById(id);
  return row ? toCourseDto(row) : null;
};

export const listActiveCourses = async (search?: string): Promise<CourseDto[]> => {
  const rows = await repo.listActiveCourses({ search: search?.trim() || undefined });
  return rows.map(toCourseDto);
};

export const listActiveCoursesByCategory = async (
  categoryId: number
): Promise<CourseDto[]> => {
  const rows = await repo.listActiveCoursesByCategory(categoryId);
  return rows.map(toCourseDto);
};
