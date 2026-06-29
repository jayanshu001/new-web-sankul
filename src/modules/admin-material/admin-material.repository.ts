import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-material MySQL branch.
 *  - categories → ws_material_category (single `parent` int FK; NO ancestors[]/
 *    childCategoryIds[] — that DAG is Mongo-only). roots use parent = 0 sentinel.
 *  - materials  → ws_material (leaf; minimal columns — most Mongo fields absent).
 *
 * ⚠ Drift: ws_material_category.parent is NOT NULL (0 = root). ws_material has NO
 * column for description/thumbnail/fileSize/fileMime/language/isPreview/isPaid/
 * downloadCount — dropped on write, synthesized on read.
 */
const ROOT = 0;

export const adminMaterialRepository = {
  // ── categories ────────────────────────────────────────────────────────────
  listAllCategories: (status?: boolean) =>
    prisma.materialCategory.findMany({ where: status === undefined ? {} : { status }, orderBy: [{ order_by: "asc" }, { name: "asc" }] }),

  listCategories: (opts: { parent?: number | "root"; search?: string; status?: boolean; sortBy?: string; sortDir: "asc" | "desc"; skip: number; take: number }) =>
    prisma.materialCategory.findMany({ where: buildCatWhere(opts), orderBy: catOrderBy(opts.sortBy, opts.sortDir), skip: opts.skip, take: opts.take }),
  countCategories: (opts: { parent?: number | "root"; search?: string; status?: boolean }) =>
    prisma.materialCategory.count({ where: buildCatWhere(opts) }),

  findCategoryById: (id: number) => prisma.materialCategory.findUnique({ where: { id } }),
  childCount: (id: number) => prisma.materialCategory.count({ where: { parent: id } }),
  /**
   * Of the given category ids, which have ≥1 child — one distinct query. Used to
   * flag non-leaf categories in the list (a container is non-leaf regardless of
   * its children's status).
   */
  parentIdsWithChildren: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.materialCategory.findMany({ where: { parent: { in: categoryIds } }, distinct: ["parent"], select: { parent: true } })
      : Promise.resolve([]),
  materialCountForCategory: (id: number) => prisma.material.count({ where: { materialCategoryId: id } }),

  createCategory: (data: Prisma.MaterialCategoryUncheckedCreateInput) => prisma.materialCategory.create({ data }),
  updateCategory: (id: number, data: Prisma.MaterialCategoryUncheckedUpdateInput) => prisma.materialCategory.update({ where: { id }, data }),
  deleteCategory: (id: number) => prisma.materialCategory.delete({ where: { id } }),
  setCategoryStatus: (id: number, status: boolean) => prisma.materialCategory.update({ where: { id }, data: { status, updated_at: new Date() } }),
  setCategoryOrder: (id: number, order: number) => prisma.materialCategory.update({ where: { id }, data: { order_by: order, updated_at: new Date() } }),

  /** Courses that reference this material category (via the pivot ws_material_category_course). */
  coursesForCategory: (categoryId: number) =>
    prisma.materialCategoryCourse.findMany({ where: { materialCategoryId: categoryId }, include: { Course: { select: { id: true, name: true, image: true, level: true, status: true } } } }),

  // ── materials (leaf) ──────────────────────────────────────────────────────
  listMaterials: (opts: { search?: string; materialCategoryId?: number; status?: boolean; skip: number; take: number }) =>
    prisma.material.findMany({ where: buildMatWhere(opts), include: { MaterialCategory: { select: { id: true, name: true } } }, orderBy: [{ order_by: "asc" }, { created_at: "desc" }], skip: opts.skip, take: opts.take }),
  countMaterials: (opts: { search?: string; materialCategoryId?: number; status?: boolean }) => prisma.material.count({ where: buildMatWhere(opts) }),
  materialsForCategory: (categoryId: number, skip: number, take: number) =>
    prisma.material.findMany({ where: { materialCategoryId: categoryId }, orderBy: [{ order_by: "asc" }, { created_at: "desc" }], skip, take }),

  findMaterialById: (id: number) => prisma.material.findUnique({ where: { id }, include: { MaterialCategory: { select: { id: true, name: true } } } }),
  findMaterialBare: (id: number) => prisma.material.findUnique({ where: { id } }),

  createMaterial: (data: Prisma.MaterialUncheckedCreateInput) => prisma.material.create({ data, include: { MaterialCategory: { select: { id: true, name: true } } } }),
  updateMaterial: (id: number, data: Prisma.MaterialUncheckedUpdateInput) => prisma.material.update({ where: { id }, data, include: { MaterialCategory: { select: { id: true, name: true } } } }),
  deleteMaterial: (id: number) => prisma.material.delete({ where: { id } }),
  setMaterialStatus: (id: number, status: boolean) => prisma.material.update({ where: { id }, data: { status, updated_at: new Date() } }),
  setMaterialOrder: (id: number, categoryId: number, order: number) =>
    prisma.material.updateMany({ where: { id, materialCategoryId: categoryId }, data: { order_by: order } }),
  bulkSetStatus: (ids: number[], status: boolean) => prisma.material.updateMany({ where: { id: { in: ids } }, data: { status } }),
  bulkDelete: (ids: number[]) => prisma.material.deleteMany({ where: { id: { in: ids } } }),
};

export { ROOT };

function catOrderBy(sortBy: string | undefined, dir: "asc" | "desc"): Prisma.MaterialCategoryOrderByWithRelationInput[] {
  if (sortBy === "title" || sortBy === "name") return [{ name: dir }, { name: "asc" }];
  if (sortBy === "createdAt") return [{ created_at: dir }, { name: "asc" }];
  if (sortBy === "order") return [{ order_by: dir }, { name: "asc" }];
  return [{ order_by: "asc" }, { name: "asc" }];
}

function buildCatWhere(opts: { parent?: number | "root"; search?: string; status?: boolean }): Prisma.MaterialCategoryWhereInput {
  const where: Prisma.MaterialCategoryWhereInput = {};
  if (opts.parent === "root") where.parent = ROOT;
  else if (typeof opts.parent === "number") where.parent = opts.parent;
  if (opts.search) where.name = { contains: opts.search.trim() };
  if (opts.status !== undefined) where.status = opts.status;
  return where;
}

function buildMatWhere(opts: { search?: string; materialCategoryId?: number; status?: boolean }): Prisma.MaterialWhereInput {
  const where: Prisma.MaterialWhereInput = {};
  if (opts.search) where.name = { contains: opts.search.trim() };
  if (opts.materialCategoryId !== undefined) where.materialCategoryId = opts.materialCategoryId;
  if (opts.status !== undefined) where.status = opts.status;
  return where;
}
