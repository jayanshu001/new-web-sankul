import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the catalog · exam READ branch (flag OFF). Scoped to
 * category navigation: a parent category, its active (status + not-deleted)
 * children via the `parent_id` self-FK, per-child UNCONDITIONAL exam counts, and
 * a has-grandchildren check.
 */
export const catalogExamRepository = {
  /** Single exam category by id. */
  findCategoryById: (id: number) =>
    prisma.examCategory.findUnique({ where: { id } }),

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
