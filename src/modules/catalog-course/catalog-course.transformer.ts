// Course catalog: row to DTO mapping (response shape is frozen).
import type { Course, CourseSubjectCategory } from "@prisma/client";
import type {
  CourseDto,
  CourseListItemDto,
  CoursePlanBuckets,
  CourseRefDto,
  CourseSubjectCategoryDto,
  CourseSubjectCategoryWithCountDto,
} from "./catalog-course.types";

type CourseRowWithRefs = Course & {
  educator?: { id: number; name: string | null } | null;
  subject?: { id: number; title: string } | null;
  VideoCategory?: { id: number; title: string } | null;
};

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

export const toCourseCategoryWithCountDto = (
  row: CourseSubjectCategory,
  courseCount: number
): CourseSubjectCategoryWithCountDto => ({
  ...toCourseCategoryDto(row),
  courseCount,
});

const toIsPopular = (v: Course["is_featured"]): boolean => v === "yes";

/** Unset `purchase` means paid; only an explicit "no" is free. */
const toIsPaid = (v: Course["purchase"]): boolean => v !== "no";

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

const toNameRef = (
  ref: { id: number; name: string | null } | null | undefined
): CourseRefDto | null => (ref ? { _id: String(ref.id), name: ref.name ?? "" } : null);

const toTitleRef = (
  ref: { id: number; title: string } | null | undefined
): CourseRefDto | null => (ref ? { _id: String(ref.id), title: ref.title } : null);

/** Populated refs replace the scalar ids, falling back to the id string when the relation row is missing. */
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
