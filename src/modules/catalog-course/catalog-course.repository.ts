import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

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
  /** Active subject categories, by `order_by ASC` then `created_at ASC`. */
  listActiveCategories: () =>
    prisma.courseSubjectCategory.findMany({
      where: { status: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),

  /**
   * Paginated active subject categories, with an optional title search. Same
   * sort as `listActiveCategories`. Returns `[rows, total]` over an IDENTICAL
   * where (Promise.all).
   */
  paginateActiveCategories: (args: { search?: string; skip: number; take: number }) => {
    const where = {
      status: true,
      ...(buildPrismaSearch(args.search, ["title"]) ?? {}),
    };
    return Promise.all([
      prisma.courseSubjectCategory.findMany({
        where,
        orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
        skip: args.skip,
        take: args.take,
      }),
      prisma.courseSubjectCategory.count({ where }),
    ]);
  },

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

  /** Active courses, `order_by ASC, created_at ASC`. Optional name/desc search. */
  listActiveCourses: (opts?: { search?: string }) =>
    prisma.course.findMany({
      where: {
        status: true,
        ...(buildPrismaSearch(opts?.search, ["name", "description"]) ?? {}),
      },
      orderBy: [{ ordered: "asc" }, { createdAt: "asc" }],
    }),

  /** Active courses inside a given subject category. */
  listActiveCoursesByCategory: (categoryId: number) =>
    prisma.course.findMany({
      where: { status: true, courseSubjectCategoryId: categoryId },
      orderBy: [{ ordered: "asc" }, { createdAt: "asc" }],
    }),

  /**
   * Paginated active courses for the `listCourses` handler — supports the
   * `isPopular` filter, name/description search, sort, and an optional category
   * restriction. Includes the lightweight populated refs the handler embeds
   * (`courseEducatorId` {_id,name}, `courseSubjectCategoryId`/`videoCategoryId`
   * {_id,title}). Returns `[rows, total]`.
   */
  paginateActiveCourses: (args: {
    where: {
      isPopular?: boolean;
      search?: string;
      categoryId?: number;
    };
    orderBy: { field: "createdAt" | "ordered" | "name"; dir: "asc" | "desc" };
    skip: number;
    take: number;
  }) => {
    const where = {
      status: true,
      ...(args.where.isPopular != null
        ? { is_featured: args.where.isPopular ? ("yes" as const) : ("no" as const) }
        : {}),
      ...(args.where.categoryId != null
        ? { courseSubjectCategoryId: args.where.categoryId }
        : {}),
      ...(buildPrismaSearch(args.where.search, ["name", "description"]) ?? {}),
    };
    return Promise.all([
      prisma.course.findMany({
        where,
        // Client catalog ordering: the chosen field first, then `created_at ASC`
        // as the tiebreaker (falling back to id when the field IS createdAt).
        orderBy: [
          { [args.orderBy.field]: args.orderBy.dir },
          args.orderBy.field === "createdAt" ? { id: "asc" as const } : { createdAt: "asc" as const },
        ],
        skip: args.skip,
        take: args.take,
        include: {
          educator: { select: { id: true, name: true } },
          subject: { select: { id: true, title: true } },
          VideoCategory: { select: { id: true, title: true } },
        },
      }),
      prisma.course.count({ where }),
    ]);
  },
};
