import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the catalog · exam READ branch (flag OFF). Scoped to
 * category navigation: a parent category, its active (status + not-deleted)
 * children via the `parent_id` self-FK, per-child UNCONDITIONAL exam counts, and
 * a has-grandchildren check.
 */
export const catalogExamRepository = {
  /** Single non-deleted exam category by id (soft-deleted rows read as absent → 404). */
  findCategoryById: (id: number) =>
    prisma.examCategory.findFirst({ where: { id, deleted: false } }),

  // ── category writes ─────────────────────────────────────────────────────────
  createCategory: (data: Prisma.ExamCategoryUncheckedCreateInput) =>
    prisma.examCategory.create({ data }),
  updateCategory: (id: number, data: Prisma.ExamCategoryUncheckedUpdateInput) =>
    prisma.examCategory.update({ where: { id }, data }),
  /** Soft-delete (deleted=true) — reads already exclude these; avoids dangling pivots. */
  softDeleteCategory: (id: number) =>
    prisma.examCategory.update({ where: { id }, data: { deleted: true, updated_at: new Date() } }),
  /** Active (not soft-deleted) direct children of a category. */
  childCount: (id: number) =>
    prisma.examCategory.count({ where: { parent: id, deleted: false } }),
  /** Exams referencing this category (any status). */
  examCountForCategory: (id: number) =>
    prisma.exam.count({ where: { examCategoryId: id } }),

  /**
   * List exam categories with optional parent / name-search / status filters.
   * Always excludes soft-deleted rows (Mongo parity — deleted docs don't exist
   * in Mongo). Ordered by `order_by, name` to match the Mongo `{ orderBy:1, name:1 }`.
   * `parentRoot` selects top-level rows (parent_id = 0, the SQL root sentinel).
   * When `skip`/`take` are provided the result is paginated.
   */
  listCategories: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
    skip?: number;
    take?: number;
    /** Admin listing: newest-created first. Default keeps the curated order_by sort. */
    newestFirst?: boolean;
  }) => {
    const where = catalogExamRepository.categoryWhere(opts);
    return prisma.examCategory.findMany({
      where,
      orderBy: opts.newestFirst
        ? [{ created_at: "desc" }, { id: "desc" }]
        : [{ order_by: "asc" }, { name: "asc" }],
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    });
  },

  /** Count matching the same filter as `listCategories` (for pagination). */
  countCategories: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
  }) => prisma.examCategory.count({ where: catalogExamRepository.categoryWhere(opts) }),

  /** Shared WHERE builder for the category list/count. */
  categoryWhere: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
  }) => {
    const where: any = { deleted: false };
    if (opts.parentRoot) where.parent = 0;
    else if (opts.parentId !== undefined) where.parent = opts.parentId;
    if (opts.search) where.name = { contains: opts.search };
    if (opts.status !== undefined) where.status = opts.status;
    return where;
  },

  /** All active (status + not-deleted) categories, for tree assembly. */
  listAllActive: () =>
    prisma.examCategory.findMany({
      where: { status: true, deleted: false },
      orderBy: [{ order_by: "asc" }, { name: "asc" }],
    }),

  /** Packages linked to a category via ws_exam_category_package (paginated). */
  listCategoryPackages: (
    categoryId: number,
    opts: { search?: string; status?: boolean; skip: number; take: number }
  ) =>
    prisma.package.findMany({
      where: catalogExamRepository.categoryPackageWhere(categoryId, opts),
      select: { id: true, name: true, shareable_link: true, active: true, order_by: true },
      orderBy: [{ order_by: "asc" }, { created_at: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  countCategoryPackages: (
    categoryId: number,
    opts: { search?: string; status?: boolean }
  ) =>
    prisma.package.count({ where: catalogExamRepository.categoryPackageWhere(categoryId, opts) }),

  categoryPackageWhere: (
    categoryId: number,
    opts: { search?: string; status?: boolean }
  ) => {
    const where: any = { examCategoryPackage: { some: { examCategoryId: categoryId } } };
    if (opts.search) where.name = { contains: opts.search };
    if (opts.status !== undefined) where.active = opts.status;
    return where;
  },

  /** Default/active price rows for the given package ids (representative price). */
  listPackagePrices: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { packageId: { in: packageIds }, status: true },
          select: { packageId: true, price: true, isDefault: true },
        })
      : Promise.resolve([]),

  /** Courses linked to a category via ws_exam_category_course (paginated). */
  listCategoryCourses: (
    categoryId: number,
    opts: { search?: string; status?: boolean; skip: number; take: number }
  ) =>
    prisma.course.findMany({
      where: catalogExamRepository.categoryCourseWhere(categoryId, opts),
      select: { id: true, name: true, status: true, ordered: true },
      orderBy: [{ ordered: "asc" }, { createdAt: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  countCategoryCourses: (
    categoryId: number,
    opts: { search?: string; status?: boolean }
  ) =>
    prisma.course.count({ where: catalogExamRepository.categoryCourseWhere(categoryId, opts) }),

  categoryCourseWhere: (
    categoryId: number,
    opts: { search?: string; status?: boolean }
  ) => {
    const where: any = { examCategoryCourse: { some: { examCategoryId: categoryId } } };
    if (opts.search) where.name = { contains: opts.search };
    if (opts.status !== undefined) where.status = opts.status;
    return where;
  },

  /**
   * Active (status + not-deleted) child categories of `parentId`, ordered by
   * `order_by`. Optional name search. Mirrors the Mongo
   * `ExamCategory.find({_id:{$in:childCategoryIds}, status:true})`.
   */
  listActiveChildren: (parentId: number, opts?: { search?: string }) =>
    prisma.examCategory.findMany({
      where: {
        parent: parentId,
        status: true,
        deleted: false,
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ order_by: "asc" }, { id: "asc" }],
    }),

  /** UNCONDITIONAL count of exams in a category (no status filter — Mongo parity). */
  countExams: (categoryId: number) =>
    prisma.exam.count({ where: { examCategoryId: categoryId } }),

  /**
   * Of the given category ids, which have ≥1 active child (parent_id in ids).
   * One distinct query → `havingChildDirectory` without N round-trips.
   */
  parentsWithChildren: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.examCategory.findMany({
          where: { parent: { in: categoryIds }, status: true, deleted: false },
          distinct: ["parent"],
          select: { parent: true },
        })
      : Promise.resolve([]),
};
