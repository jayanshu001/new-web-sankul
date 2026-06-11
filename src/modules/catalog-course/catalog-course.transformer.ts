import type { Course, CourseSubjectCategory } from "@prisma/client";
import type {
  CourseDto,
  CourseSubjectCategoryDto,
  CourseSubjectCategoryWithCountDto,
} from "./catalog-course.types";

/** `ws_course_subject_category` row → DTO. */
export const toCourseCategoryDto = (
  row: CourseSubjectCategory
): CourseSubjectCategoryDto => ({
  _id: String(row.id),
  title: row.title,
  slug: row.slug,
  image: row.image,
  parent: row.parent,
  order: row.order,
  status: row.status,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

/** As above + the active-course count (listCourseCategories contract). */
export const toCourseCategoryWithCountDto = (
  row: CourseSubjectCategory,
  courseCount: number
): CourseSubjectCategoryWithCountDto => ({
  ...toCourseCategoryDto(row),
  courseCount,
});

/**
 * `ws_course` row → DTO (flag OFF). Only maps columns that physically exist in
 * `ws_course`. The SQL enums `is_featured`/`purchase` and `featured_order` are
 * unmapped in Prisma (no consumer reads them off the migrated row); the
 * Mongo-only fields and all commerce joins are intentionally NOT produced here
 * (see catalog-course.types.ts scope note).
 */
export const toCourseDto = (row: Course): CourseDto => ({
  _id: String(row.id),
  name: row.name ?? null,
  description: row.description,
  image: row.image ?? null,
  shareableLink: row.shareableLink,
  withMaterial: row.withMaterial,
  withoutMaterial: row.withoutMaterial,
  level: row.level,
  order: row.ordered,
  status: row.status,
  courseSubjectCategoryId:
    row.courseSubjectCategoryId != null ? String(row.courseSubjectCategoryId) : null,
  courseEducatorId: row.courseEducatorId != null ? String(row.courseEducatorId) : null,
  videoCategoryId: row.videoCategoryId != null ? String(row.videoCategoryId) : null,
  pcMaterialId: row.pcMaterialId != null ? String(row.pcMaterialId) : null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
