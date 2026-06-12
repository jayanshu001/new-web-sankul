import type { Course, CourseSubjectCategory } from "@prisma/client";
import type {
  CourseDto,
  CourseListItemDto,
  CoursePlanBuckets,
  CourseRefDto,
  CourseSubjectCategoryDto,
  CourseSubjectCategoryWithCountDto,
} from "./catalog-course.types";

/** A Course row read with the listing's lightweight refs included. */
type CourseRowWithRefs = Course & {
  educator?: { id: number; name: string | null } | null;
  subject?: { id: number; title: string } | null;
  VideoCategory?: { id: number; title: string } | null;
};

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
 * SQL `is_featured` enum('0','1') → Mongo `isPopular` (default false).
 * Only an explicit '1' is popular; NULL/'0' → false.
 */
const toIsPopular = (v: Course["is_featured"]): boolean => v === "yes";

/**
 * SQL `purchase` enum('0','1') → Mongo `isPaid`. The Mongo model defaults
 * `isPaid` to TRUE, so NULL (unset) and '1' → true; only an explicit '0' → false.
 */
const toIsPaid = (v: Course["purchase"]): boolean => v !== "no";

/**
 * `ws_course` row → DTO (flag OFF). The SQL enums `is_featured`/`purchase` are
 * now surfaced as the Mongo booleans `isPopular`/`isPaid` (needed by the course
 * listing's filter + response). `featured_order` is mapped in Prisma but not
 * surfaced (no consumer reads it). Other Mongo-only fields and the commerce
 * joins are produced by the composition service, not here.
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
  isPopular: toIsPopular(row.is_featured),
  isPaid: toIsPaid(row.purchase),
  courseSubjectCategoryId:
    row.courseSubjectCategoryId != null ? String(row.courseSubjectCategoryId) : null,
  courseEducatorId: row.courseEducatorId != null ? String(row.courseEducatorId) : null,
  videoCategoryId: row.videoCategoryId != null ? String(row.videoCategoryId) : null,
  pcMaterialId: row.pcMaterialId != null ? String(row.pcMaterialId) : null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

/** `{_id,name}` ref (educator) — null if the relation is absent. */
const toNameRef = (
  ref: { id: number; name: string | null } | null | undefined
): CourseRefDto | null => (ref ? { _id: String(ref.id), name: ref.name ?? "" } : null);

/** `{_id,title}` ref (subject / video category) — null if absent. */
const toTitleRef = (
  ref: { id: number; title: string } | null | undefined
): CourseRefDto | null => (ref ? { _id: String(ref.id), title: ref.title } : null);

/**
 * A Course row (with included refs) + the composed listing fields → list item.
 * The populated ref fields REPLACE the scalar id strings on the base DTO so the
 * response matches the Mongo handler's `.populate(...)` output. Falls back to the
 * scalar id string when a relation row is missing.
 */
export const toCourseListItemDto = (
  row: CourseRowWithRefs,
  composed: { plans: CoursePlanBuckets; isPurchased: boolean; daysLeft: number | null }
): CourseListItemDto => {
  const base = toCourseDto(row);
  return {
    ...base,
    courseEducatorId: toNameRef(row.educator) ?? base.courseEducatorId,
    courseSubjectCategoryId: toTitleRef(row.subject) ?? base.courseSubjectCategoryId,
    videoCategoryId: toTitleRef(row.VideoCategory) ?? base.videoCategoryId,
    plans: composed.plans,
    isPurchased: composed.isPurchased,
    daysLeft: composed.daysLeft,
  };
};
