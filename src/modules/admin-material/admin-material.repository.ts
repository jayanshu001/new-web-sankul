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

  /**
   * Deep-clone a category subtree (single-parent `parent` tree — the Mongo
   * `ancestors[]` DAG is not used here) plus all `ws_material` rows under it, in
   * one interactive transaction.
   *   1. Walk children via `where parent = <id>` to collect the subtree.
   *   2. Create the root clone (new title, same parent as source).
   *   3. Create each descendant clone, remapping old parent id → new id via an
   *      id-map (one-by-one so create() returns the new id — createMany does not).
   *   4. Clone every material whose category is in the cloned set, remapping the
   *      category id.
   * Returns null when the source category does not exist.
   */
  cloneCategoryTree: async (sourceId: number) => {
    const source = await prisma.materialCategory.findUnique({ where: { id: sourceId } });
    if (!source) return null;

    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const newTitle = await nextAvailableCopyTitle(tx, source.name, source.parent);

      // old category id → new category id
      const idMap = new Map<number, number>();

      const root = await tx.materialCategory.create({
        data: {
          name: newTitle,
          slug: slugify(newTitle),
          image: source.image ?? null,
          parent: source.parent,
          order_by: source.order_by,
          status: source.status,
          created_at: now,
          updated_at: now,
        },
      });
      idMap.set(source.id, root.id);

      // BFS over descendants, remapping parent ids as we go.
      let subCategories = 0;
      const queue: number[] = [source.id];
      while (queue.length) {
        const parentOldId = queue.shift()!;
        const children = await tx.materialCategory.findMany({ where: { parent: parentOldId }, orderBy: { id: "asc" } });
        for (const child of children) {
          const newParentId = idMap.get(parentOldId)!;
          const childClone = await tx.materialCategory.create({
            data: {
              name: child.name,
              slug: child.slug || slugify(child.name),
              image: child.image ?? null,
              parent: newParentId,
              order_by: child.order_by,
              status: child.status,
              created_at: now,
              updated_at: now,
            },
          });
          idMap.set(child.id, childClone.id);
          subCategories += 1;
          queue.push(child.id);
        }
      }

      // Clone materials across every mapped category, remapping the category id.
      const oldCategoryIds = Array.from(idMap.keys());
      const materials = await tx.material.findMany({ where: { materialCategoryId: { in: oldCategoryIds } } });
      if (materials.length) {
        await tx.material.createMany({
          data: materials.map((m) => ({
            materialCategoryId: idMap.get(m.materialCategoryId!)!,
            name: m.name,
            direct_link: m.direct_link,
            file: m.file,
            fileName: m.fileName,
            order_by: m.order_by,
            status: m.status,
            description: m.description,
            thumbnail: m.thumbnail,
            fileSize: m.fileSize,
            fileMime: m.fileMime,
            language: m.language,
            isPreview: m.isPreview,
            isPaid: m.isPaid,
            created_at: now,
            updated_at: now,
          })),
        });
      }

      return { root, subCategories, materials: materials.length };
    });
  },
};

/**
 * Next free "<title> (Copy)" / "<title> (Copy N)" among siblings sharing the same
 * `parent`. Mirrors the Mongo helper: prefilter by prefix in SQL, disambiguate the
 * suffix number in JS.
 */
async function nextAvailableCopyTitle(
  tx: Prisma.TransactionClient,
  baseTitle: string,
  parent: number,
): Promise<string> {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = `${baseTitle} (Copy`;
  const regex = new RegExp(`^${escape(base)}(?:\\s(\\d+))?\\)$`);
  const siblings = await tx.materialCategory.findMany({
    where: { parent, name: { startsWith: base } },
    select: { name: true },
  });
  const taken = new Set<number>();
  for (const s of siblings) {
    const m = (s.name || "").match(regex);
    if (!m) continue;
    taken.add(m[1] ? parseInt(m[1], 10) : 1);
  }
  if (!taken.has(1)) return `${baseTitle} (Copy)`;
  let n = 2;
  while (taken.has(n)) n++;
  return `${baseTitle} (Copy ${n})`;
}

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
