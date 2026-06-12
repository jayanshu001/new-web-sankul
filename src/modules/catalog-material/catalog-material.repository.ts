import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the catalog · material READ branch (flag OFF).
 * Scoped to category navigation: a parent category, its active child
 * categories (`parent = id`), per-child active-material counts, and a
 * has-grandchildren check. NO entitlement/item gating (that path stays Mongo).
 */
export const catalogMaterialRepository = {
  /** Single material category by id. */
  findCategoryById: (id: number) =>
    prisma.materialCategory.findUnique({ where: { id } }),

  /**
   * Active child categories of `parentId` (SQL `parent` self-FK), ordered by
   * `order_by`. Optional title search. Mirrors the Mongo
   * `MaterialCategory.find({_id:{$in:childCategoryIds}, status:true})`.
   */
  listActiveChildren: (parentId: number, opts?: { search?: string }) =>
    prisma.materialCategory.findMany({
      where: {
        parent: parentId,
        status: true,
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ order_by: "asc" }, { id: "asc" }],
    }),

  /** Count of active materials directly in a category. */
  countActiveMaterials: (categoryId: number) =>
    prisma.material.count({ where: { materialCategoryId: categoryId, status: true } }),

  /**
   * For a set of category ids, which ones have ≥1 child category (parent in
   * ids). Returns the distinct set of parent ids that are referenced — used to
   * compute `havingChildDirectory` in one query instead of N.
   */
  parentsWithChildren: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.materialCategory.findMany({
          where: { parent: { in: categoryIds }, status: true },
          distinct: ["parent"],
          select: { parent: true },
        })
      : Promise.resolve([]),
};
