import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the catalog · course MySQL branch (flag OFF).
 *
 *  - `ws_course_subject_category` reads back the subject-category lookup, with an
 *    active-course count grouped per category (the listCourseCategories contract).
 *  - `ws_course` reads back active courses (the row data only — plans/ownership
 *    joins stay Mongo/commerce-wave). Only physically-present columns are mapped;
 *    see catalog-course.types.ts for the field/commerce-scope gap.
 */
export const catalogCourseRepository = {
  // ── subject category (ws_course_subject_category) ────────────────────────
  /** Active subject categories, by `order_by` then title (mirrors Mongo sort). */
  listActiveCategories: () =>
    prisma.courseSubjectCategory.findMany({
      where: { status: true },
      orderBy: [{ order: "asc" }, { title: "asc" }],
    }),

  /**
   * Active-course count per subject-category id. Mirrors the Mongo aggregate
   * `{$match:{status:true}}` → `{$group: _id:courseSubjectCategoryId}`.
   */
  countActiveCoursesByCategory: (categoryIds: number[]) =>
    prisma.course.groupBy({
      by: ["courseSubjectCategoryId"],
      where: { status: true, courseSubjectCategoryId: { in: categoryIds } },
      _count: { _all: true },
    }),

  // ── course (ws_course) ───────────────────────────────────────────────────
  /** Single active course by id. */
  findCourseById: (id: number) =>
    prisma.course.findFirst({ where: { id, status: true } }),

  /** Active courses, ordered by `order_by` then id. Optional name/desc search. */
  listActiveCourses: (opts?: { search?: string }) =>
    prisma.course.findMany({
      where: {
        status: true,
        ...(opts?.search
          ? {
              OR: [
                { name: { contains: opts.search } },
                { description: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ ordered: "asc" }, { id: "desc" }],
    }),

  /** Active courses inside a given subject category. */
  listActiveCoursesByCategory: (categoryId: number) =>
    prisma.course.findMany({
      where: { status: true, courseSubjectCategoryId: categoryId },
      orderBy: [{ ordered: "asc" }, { id: "desc" }],
    }),
};
