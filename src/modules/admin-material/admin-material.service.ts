import { adminMaterialRepository as repo, ROOT } from "./admin-material.repository";
import { buildPagination } from "../../utils/listQuery";
import type { MaterialCategory, Material } from "@prisma/client";

export const ADMIN_MATERIAL_MODULE = "admin-material";
export const isAdminMaterialMysql = (): boolean => true;

export const parseMaterialId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const slugify = (input: string): string =>
  input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ── transformers ─────────────────────────────────────────────────────────────
/**
 * `ws_material_category` row → Mongo-shaped MaterialCategory. parent 0 → null
 * (root); ancestors[]/childCategoryIds[] synthesized empty (single-parent SQL).
 */
export const toCategoryDto = (row: MaterialCategory) => ({
  _id: String(row.id),
  title: row.name,
  slug: row.slug,
  image: row.image ?? null,
  parent: row.parent && row.parent > 0 ? String(row.parent) : null,
  ancestors: [],
  childCategoryIds: [],
  order: row.order_by,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

/** `ws_material` row → Mongo-shaped Material. SQL-absent fields synthesized. */
type MatRow = Material & { MaterialCategory?: { id: number; name: string } | null };
export const toMaterialDto = (row: MatRow) => ({
  _id: String(row.id),
  title: row.name,
  description: null,
  materialCategoryId: row.materialCategoryId != null ? String(row.materialCategoryId) : null,
  // Related category (id + name) for display — joined via the repo's include.
  materialCategory: row.MaterialCategory ? { id: String(row.MaterialCategory.id), name: row.MaterialCategory.name } : null,
  file: row.file,
  fileName: row.fileName ?? null,
  directLink: row.direct_link ?? "",
  thumbnail: null,
  fileSize: null,
  fileMime: null,
  language: null,
  isPreview: false,
  isPaid: false,
  downloadCount: 0,
  order: row.order_by,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

// ── categories: list / tree / get ──────────────────────────────────────────────
export const listCategoriesTree = async (status?: boolean) => {
  const all = await repo.listAllCategories(status);
  const byParent = new Map<number, any[]>();
  for (const c of all) {
    const k = c.parent && c.parent > 0 ? c.parent : ROOT;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(toCategoryDto(c));
  }
  const attach = (node: any): any => {
    node.children = (byParent.get(Number(node._id)) ?? []).map(attach);
    return node;
  };
  return (byParent.get(ROOT) ?? []).map(attach);
};

export const listCategories = async (q: { parent?: string; search?: string; status?: boolean; sortBy?: string; sortOrder?: string; page: number; limit: number }) => {
  let parent: number | "root" | undefined;
  if (q.parent === "root" || q.parent === "null") parent = "root";
  else if (q.parent) parent = parseMaterialId(q.parent) ?? undefined;
  const opts = { parent, search: q.search, status: q.status, sortBy: q.sortBy, sortDir: (q.sortOrder === "desc" ? "desc" : "asc") as "asc" | "desc" };
  const [rows, total] = await Promise.all([
    repo.listCategories({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countCategories(opts),
  ]);
  // Flag non-leaf rows so pickers can restrict selection to leaves even when the
  // list is a search-filtered/paginated subset (a parent's children may be absent
  // from this page).
  const parents = await repo.parentIdsWithChildren(rows.map((r) => r.id));
  const withChildren = new Set(parents.map((p) => p.parent));
  return { data: rows.map((row) => ({ ...toCategoryDto(row), hasChildren: withChildren.has(row.id) })), total };
};

export const getCategoryById = async (id: number) => {
  const row = await repo.findCategoryById(id);
  return row ? toCategoryDto(row) : null;
};

// ── categories: write (single-parent; DAG dropped) ──────────────────────────────
export interface CategoryWriteInput { title?: string; slug?: string; image?: string; parent?: string | null; order?: number; status?: boolean }

export const createCategory = async (d: CategoryWriteInput) => {
  const now = new Date();
  // root = parent 0 sentinel (ws_material_category.parent is NOT NULL).
  const parent = d.parent ? parseMaterialId(d.parent) ?? ROOT : ROOT;
  const created = await repo.createCategory({
    name: d.title ?? "",
    slug: d.slug || slugify(d.title ?? ""),
    image: d.image ?? null,
    parent,
    order_by: d.order ?? 0,
    status: d.status ?? true,
    created_at: now, updated_at: now,
  });
  return toCategoryDto(created);
};

export const updateCategory = async (id: number, d: CategoryWriteInput): Promise<"not_found" | "self_parent" | any> => {
  if (!(await repo.findCategoryById(id))) return "not_found";
  const data: any = { updated_at: new Date() };
  if (d.parent !== undefined) {
    const p = d.parent ? parseMaterialId(d.parent) ?? ROOT : ROOT;
    if (p === id) return "self_parent";
    data.parent = p;
  }
  if (d.title !== undefined) {
    data.name = d.title;
    if (d.slug === undefined) data.slug = slugify(d.title);
  }
  if (d.slug !== undefined) data.slug = d.slug;
  if (d.image !== undefined) data.image = d.image;
  if (d.order !== undefined) data.order_by = d.order;
  if (d.status !== undefined) data.status = d.status;
  return toCategoryDto(await repo.updateCategory(id, data));
};

export const deleteCategory = async (id: number): Promise<"not_found" | "has_children" | "has_materials" | true> => {
  if (!(await repo.findCategoryById(id))) return "not_found";
  if ((await repo.childCount(id)) > 0) return "has_children";
  if ((await repo.materialCountForCategory(id)) > 0) return "has_materials";
  await repo.deleteCategory(id);
  return true;
};

export const toggleCategoryStatus = async (id: number): Promise<"not_found" | { status: boolean }> => {
  const c = await repo.findCategoryById(id);
  if (!c) return "not_found";
  const updated = await repo.setCategoryStatus(id, !c.status);
  return { status: updated.status };
};

export const reorderCategories = async (orders: Array<{ id: string; order: number }>): Promise<"dup" | "no_valid" | true> => {
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) return "dup";
  const valid = orders.map((o) => ({ id: parseMaterialId(o.id), order: o.order })).filter((o) => o.id != null);
  if (!valid.length) return "no_valid";
  await Promise.all(valid.map((o) => repo.setCategoryOrder(o.id!, o.order)));
  return true;
};

/**
 * Deep-clone a category subtree + its materials. Returns "not_found" when the
 * source category is absent, else a DTO matching the legacy Mongo handler shape:
 * `{ id, name, parent, createdAt, itemsCloned: { subCategories, materials } }`.
 */
export const duplicateCategory = async (id: number): Promise<"not_found" | {
  id: string;
  name: string;
  parent: string | null;
  createdAt: Date | null;
  itemsCloned: { subCategories: number; materials: number };
}> => {
  const result = await repo.cloneCategoryTree(id);
  if (!result) return "not_found";
  const { root, subCategories, materials } = result;
  return {
    id: String(root.id),
    name: root.name,
    parent: root.parent && root.parent > 0 ? String(root.parent) : null,
    createdAt: root.created_at ?? null,
    itemsCloned: { subCategories, materials },
  };
};

// category sub-resources
export const getCategoryCourses = async (
  id: number,
  q: { search?: string; skip: number; take: number; page: number; limit: number },
) => {
  const [rows, total] = await Promise.all([
    repo.coursesForCategory(id, { search: q.search, skip: q.skip, take: q.take }),
    repo.countCoursesForCategory(id, q.search),
  ]);
  const data = rows
    .filter((r) => r.Course)
    .map((r) => ({ _id: String(r.Course!.id), name: r.Course!.name ?? null, image: r.Course!.image ?? null, level: r.Course!.level, status: r.Course!.status }));
  return { data, pagination: buildPagination(total, q.page, q.limit) };
};

export const getCategoryMaterials = async (id: number, page: number, limit: number) => {
  const [rows, total] = await Promise.all([
    repo.materialsForCategory(id, (page - 1) * limit, limit),
    repo.countMaterials({ materialCategoryId: id }),
  ]);
  return { data: rows.map((r) => toMaterialDto(r as MatRow)), total };
};

// ── materials (leaf) ────────────────────────────────────────────────────────────
export const listMaterials = async (q: { search?: string; materialCategoryId?: number; status?: boolean; page: number; limit: number }) => {
  const opts = { search: q.search, materialCategoryId: q.materialCategoryId, status: q.status };
  const [rows, total] = await Promise.all([
    repo.listMaterials({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countMaterials(opts),
  ]);
  return { data: rows.map((r) => toMaterialDto(r as MatRow)), total };
};

export const getMaterialById = async (id: number) => {
  const row = await repo.findMaterialById(id);
  return row ? toMaterialDto(row as MatRow) : null;
};

export interface MaterialWriteInput { title?: string; materialCategoryId?: string; file?: string; fileName?: string; directLink?: string; order?: number; status?: boolean }

export const createMaterial = async (d: MaterialWriteInput): Promise<"category" | any> => {
  const catId = d.materialCategoryId ? parseMaterialId(d.materialCategoryId) : null;
  if (!catId || !(await repo.findCategoryById(catId))) return "category";
  const now = new Date();
  // Mongo-only fields (description/thumbnail/fileSize/fileMime/language/isPreview/
  // isPaid/downloadCount) are dropped — no SQL columns.
  const created = await repo.createMaterial({
    materialCategoryId: catId,
    name: d.title ?? "",
    file: d.file ?? "",
    fileName: d.fileName ?? null,
    direct_link: d.directLink ?? null,
    order_by: d.order ?? 0,
    status: d.status ?? true,
    created_at: now, updated_at: now,
  });
  return toMaterialDto(created as MatRow);
};

export const updateMaterial = async (id: number, d: MaterialWriteInput): Promise<"not_found" | "category" | any> => {
  if (!(await repo.findMaterialBare(id))) return "not_found";
  const data: any = { updated_at: new Date() };
  if (d.materialCategoryId !== undefined) {
    const catId = parseMaterialId(d.materialCategoryId);
    if (!catId || !(await repo.findCategoryById(catId))) return "category";
    data.materialCategoryId = catId;
  }
  if (d.title !== undefined) data.name = d.title;
  if (d.file !== undefined) data.file = d.file;
  if (d.fileName !== undefined) data.fileName = d.fileName ?? null;
  if (d.directLink !== undefined) data.direct_link = d.directLink ?? null;
  if (d.order !== undefined) data.order_by = d.order;
  if (d.status !== undefined) data.status = d.status;
  return toMaterialDto(await repo.updateMaterial(id, data) as MatRow);
};

export const deleteMaterial = async (id: number): Promise<boolean> => {
  if (!(await repo.findMaterialBare(id))) return false;
  await repo.deleteMaterial(id);
  return true;
};

export const toggleMaterialStatus = async (id: number): Promise<"not_found" | { status: boolean }> => {
  const m = await repo.findMaterialBare(id);
  if (!m) return "not_found";
  const updated = await repo.setMaterialStatus(id, !m.status);
  return { status: updated.status };
};

export const reorderMaterials = async (materialCategoryId: number, orders: Array<{ id: string; order: number }>): Promise<"dup" | "no_valid" | true> => {
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) return "dup";
  const valid = orders.map((o) => ({ id: parseMaterialId(o.id), order: o.order })).filter((o) => o.id != null);
  if (!valid.length) return "no_valid";
  await Promise.all(valid.map((o) => repo.setMaterialOrder(o.id!, materialCategoryId, o.order)));
  return true;
};

export const bulkStatus = async (ids: string[], status: boolean): Promise<"no_valid" | { modified: number }> => {
  const valid = ids.map((i) => parseMaterialId(i)).filter((n): n is number => n != null);
  if (!valid.length) return "no_valid";
  const r = await repo.bulkSetStatus(valid, status);
  return { modified: r.count };
};

export const bulkDelete = async (ids: string[]): Promise<"no_valid" | { deleted: number }> => {
  const valid = ids.map((i) => parseMaterialId(i)).filter((n): n is number => n != null);
  if (!valid.length) return "no_valid";
  const r = await repo.bulkDelete(valid);
  return { deleted: r.count };
};
