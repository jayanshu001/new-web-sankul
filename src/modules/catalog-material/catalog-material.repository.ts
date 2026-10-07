// Material categories: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const catalogMaterialRepository = {
  findCategoryById: (id: number) =>
    prisma.materialCategory.findUnique({ where: { id } }),

  listActiveChildren: (parentId: number, opts?: { search?: string; skip?: number; take?: number }) =>
    prisma.materialCategory.findMany({
      where: catalogMaterialRepository.activeChildrenWhere(parentId, opts),
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),

  countActiveChildren: (parentId: number, opts?: { search?: string }) =>
    prisma.materialCategory.count({ where: catalogMaterialRepository.activeChildrenWhere(parentId, opts) }),

  activeChildrenWhere: (parentId: number, opts?: { search?: string }) => ({
    parent: parentId,
    status: true,
    ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
  }),

  countActiveMaterials: (categoryId: number) =>
    prisma.material.count({ where: { materialCategoryId: categoryId, status: true } }),

  /** Distinct parent ids among `categoryIds` that have an active child, in one query. */
  parentsWithChildren: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.materialCategory.findMany({
          where: { parent: { in: categoryIds }, status: true },
          distinct: ["parent"],
          select: { parent: true },
        })
      : Promise.resolve([]),
};
