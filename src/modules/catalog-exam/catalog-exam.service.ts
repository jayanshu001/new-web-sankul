/**
 * Catalog · Exam service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `catalog-exam` (flag OFF). Scoped to category navigation:
 * `getCategoryChildren` reproduces `listExamCategoryChildren` (parent → active
 * children + per-child UNCONDITIONAL exam count + has-grandchildren).
 *
 * Children resolve via the SQL `parent_id` self-FK (the Mongo `childCategoryIds[]`
 * embed has no SQL column). Active = status=true AND deleted=false. See types.ts.
 */
import { catalogExamRepository as repo } from "./catalog-exam.repository";
import { toExamCategoryDto } from "./catalog-exam.transformer";
import type {
  ExamCategoryChildrenResult,
  ExamCategoryDto,
} from "./catalog-exam.types";

export const EXAM_MODULE = "catalog-exam";
export const isExamMysql = (): boolean => true;

/** Parse a string id to a positive int, else null. */
export const parseExamCategoryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Single exam category by id (the navigation `parent`). */
export const findCategoryById = async (id: number): Promise<ExamCategoryDto | null> => {
  const row = await repo.findCategoryById(id);
  return row ? toExamCategoryDto(row) : null;
};

/**
 * The `listExamCategoryChildren` composition: parent + active children, each
 * with `count` (UNCONDITIONAL exam count) and `havingChildDirectory`. Returns
 * null if the parent is missing.
 */
export const getCategoryChildren = async (
  parentId: number,
  search?: string
): Promise<ExamCategoryChildrenResult | null> => {
  const parentRow = await repo.findCategoryById(parentId);
  if (!parentRow) return null;

  const children = await repo.listActiveChildren(parentId, {
    search: search?.trim() || undefined,
  });

  const childIds = children.map((c) => c.id);
  const [counts, parentsWithKids] = await Promise.all([
    Promise.all(childIds.map((cid) => repo.countExams(cid))),
    repo.parentsWithChildren(childIds),
  ]);
  const hasKids = new Set(parentsWithKids.map((r) => r.parent));

  const list = children.map((c, i) => ({
    category: {
      ...toExamCategoryDto(c),
      count: counts[i],
      havingChildDirectory: hasKids.has(c.id),
    },
  }));

  return { parent: toExamCategoryDto(parentRow), list };
};

// ─── Admin / client category READ helpers (SQL parity) ──────────────────────
//
// The admin + client category list/tree/detail handlers historically returned
// raw Mongo `ExamCategory` docs whose keys are `_id, name, image, parentId,
// status, orderBy, createdAt, updatedAt`. These mappers reproduce that EXACT
// shape from `ws_exam_category` rows so the JSON is identical either way. The
// SQL root sentinel is `parent_id = 0`; Mongo roots have `parentId: null`, so
// we translate 0 → null on the way out.

type ExamCategoryRow = {
  id: number;
  name: string | null;
  image: string | null;
  parent: number;
  status: boolean;
  order_by: number;
  created_at: Date | null;
  updated_at: Date | null;
};

/** SQL row → admin/client-facing ExamCategory doc (Mongo key names). */
const toExamCategoryDoc = (row: ExamCategoryRow) => ({
  _id: String(row.id),
  name: row.name ?? null,
  image: row.image ?? null,
  parentId: row.parent === 0 ? null : String(row.parent),
  status: row.status,
  orderBy: row.order_by,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

/** Filters shared by the admin/client list handlers. */
export interface ListCategoriesInput {
  parentId?: string;
  search?: string;
  status?: boolean;
  skip?: number;
  take?: number;
}

const resolveParentFilter = (parentId?: string): { parentRoot?: boolean; parentNum?: number } => {
  if (parentId === "root" || parentId === "null") return { parentRoot: true };
  if (parentId) {
    const n = parseExamCategoryId(parentId);
    if (n) return { parentNum: n };
  }
  return {};
};

/** List exam categories (admin getCategories shape) — newest-created first. */
export const listCategories = async (input: ListCategoriesInput) => {
  const { parentRoot, parentNum } = resolveParentFilter(input.parentId);
  const rows = await repo.listCategories({
    parentRoot,
    parentId: parentNum,
    search: input.search?.trim() || undefined,
    status: input.status,
    skip: input.skip,
    take: input.take,
    newestFirst: true,
  });
  // Flag non-leaf rows so pickers can restrict selection to leaves even when the
  // list is a search-filtered/paginated subset (a parent's children may be absent
  // from this page).
  const parents = await repo.childParentIds(rows.map((r) => r.id));
  const withChildren = new Set(parents.map((p) => p.parent));
  return rows.map((row) => ({ ...toExamCategoryDoc(row), hasChildren: withChildren.has(row.id) }));
};

/** Count for client pagination (same filter as listCategories). */
export const countCategories = (input: ListCategoriesInput): Promise<number> => {
  const { parentRoot, parentNum } = resolveParentFilter(input.parentId);
  return repo.countCategories({
    parentRoot,
    parentId: parentNum,
    search: input.search?.trim() || undefined,
    status: input.status,
  });
};

/**
 * Client category list — same filter as `listCategories` but trimmed to the
 * fields the Mongo client handler `.select("_id name image parentId orderBy")`
 * returned, and always status=true. Paginated.
 */
export const listClientCategories = async (input: {
  parentId?: string;
  search?: string;
  skip: number;
  take: number;
}) => {
  const parentNum =
    input.parentId && input.parentId !== "root" ? parseExamCategoryId(input.parentId) : null;
  const rows = await repo.listCategories({
    parentRoot: !parentNum,
    parentId: parentNum ?? undefined,
    search: input.search?.trim() || undefined,
    status: true,
    skip: input.skip,
    take: input.take,
  });
  return rows.map((r) => ({
    _id: String(r.id),
    name: r.name ?? null,
    image: r.image ?? null,
    parentId: r.parent === 0 ? null : String(r.parent),
    orderBy: r.order_by,
  }));
};

/** Count for the client category list (status=true, same filter). */
export const countClientCategories = (input: { parentId?: string; search?: string }): Promise<number> => {
  const parentNum =
    input.parentId && input.parentId !== "root" ? parseExamCategoryId(input.parentId) : null;
  return repo.countCategories({
    parentRoot: !parentNum,
    parentId: parentNum ?? undefined,
    search: input.search?.trim() || undefined,
    status: true,
  });
};

/** Nested active-category tree (admin getCategoryTree shape: doc + children[]). */
export const getCategoryTree = async () => {
  const all = await repo.listAllActive();
  const byParent = new Map<string, any[]>();
  const docs = all.map((r) => ({ ...toExamCategoryDoc(r), _raw: r }));
  docs.forEach((d) => {
    const key = d.parentId ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(d);
  });
  const attachChildren = (node: any): any => {
    const children = byParent.get(node._id) ?? [];
    const { _raw, ...clean } = node;
    return { ...clean, children: children.map(attachChildren) };
  };
  return (byParent.get("root") ?? []).map(attachChildren);
};

/** Single category + resolved {id,name} parent (admin getCategoryById shape). */
export const getCategoryByIdWithParent = async (id: number) => {
  const row = await repo.findCategoryById(id);
  if (!row) return null;
  const doc = toExamCategoryDoc(row as ExamCategoryRow);
  let parent: { id: string; name: string | null } | null = null;
  if (row.parent && row.parent !== 0) {
    const p = await repo.findCategoryById(row.parent);
    if (p) parent = { id: String(p.id), name: p.name ?? null };
  }
  return { ...doc, parent };
};

/** Does a category exist (admin package/course guards)? */
export const categoryExists = async (id: number): Promise<boolean> =>
  Boolean(await repo.findCategoryById(id));

// ─── category writes (admin) ────────────────────────────────────────────────
// SQL is single-parent: the Mongo `childCategoryIds[]`/`ancestors[]` DAG has no
// columns and is dropped. Root sentinel is parent_id = 0.

export const createCategory = async (input: {
  name: string; image?: string | null; parentId?: string | null; orderBy?: number; status?: boolean;
}) => {
  const now = new Date();
  const parent = input.parentId ? parseExamCategoryId(input.parentId) ?? 0 : 0;
  const row = await repo.createCategory({
    name: input.name,
    image: input.image ?? null,
    parent,
    status: input.status ?? true,
    order_by: input.orderBy ?? 0,
    deleted: false,
    created_at: now,
    updated_at: now,
  });
  return toExamCategoryDoc(row as ExamCategoryRow);
};

export const updateCategory = async (
  id: number,
  input: { name?: string; image?: string | null; parentId?: string | null; orderBy?: number; status?: boolean }
): Promise<"not_found" | "self_parent" | "parent_not_found" | { data: ReturnType<typeof toExamCategoryDoc>; orphanImageUrl: string | null }> => {
  const existing = await repo.findCategoryById(id);
  if (!existing) return "not_found";

  const data: any = { updated_at: new Date() };
  let orphanImageUrl: string | null = null;
  if (input.name !== undefined) data.name = input.name;
  if (input.orderBy !== undefined) data.order_by = input.orderBy;
  if (input.status !== undefined) data.status = input.status;
  if (input.parentId !== undefined) {
    const parent = input.parentId ? parseExamCategoryId(input.parentId) ?? 0 : 0;
    if (parent === id) return "self_parent";
    if (parent !== 0 && !(await repo.findCategoryById(parent))) return "parent_not_found";
    data.parent = parent;
  }
  // null clears the image (+ orphans the old S3 object); a new URL replaces it.
  if (input.image === null) {
    data.image = null;
    orphanImageUrl = existing.image ?? null;
  } else if (input.image !== undefined) {
    data.image = input.image;
    if (existing.image && existing.image !== input.image) orphanImageUrl = existing.image;
  }

  const row = await repo.updateCategory(id, data);
  return { data: toExamCategoryDoc(row as ExamCategoryRow), orphanImageUrl };
};

export const deleteCategory = async (id: number): Promise<"not_found" | "has_children" | "has_exams" | true> => {
  if (!(await repo.findCategoryById(id))) return "not_found";
  if ((await repo.childCount(id)) > 0) return "has_children";
  if ((await repo.examCountForCategory(id)) > 0) return "has_exams";
  await repo.softDeleteCategory(id);
  return true;
};

/** Paginated packages linked to a category (admin getCategoryPackages shape). */
export const getCategoryPackages = async (
  id: number,
  opts: { search?: string; status?: boolean; page: number; per_page: number; skip: number }
) => {
  const filter = { search: opts.search?.trim() || undefined, status: opts.status };
  const [rows, total] = await Promise.all([
    repo.listCategoryPackages(id, { ...filter, skip: opts.skip, take: opts.per_page }),
    repo.countCategoryPackages(id, filter),
  ]);

  const ids = rows.map((p) => p.id);
  const priceRows = await repo.listPackagePrices(ids);
  const priceByPackage = new Map<number, number>();
  for (const r of priceRows) {
    if (r.packageId == null) continue;
    const existing = priceByPackage.get(r.packageId);
    if (r.isDefault) priceByPackage.set(r.packageId, r.price);
    else if (existing === undefined || r.price < existing)
      priceByPackage.set(r.packageId, existing === undefined ? r.price : Math.min(existing, r.price));
  }

  const items = rows.map((p) => ({
    id: String(p.id),
    name: p.name,
    price: priceByPackage.get(p.id) ?? null,
    shareableLink: p.shareable_link ?? null,
    status: p.active,
  }));
  return { items, total };
};

/** Paginated courses linked to a category (admin getCategoryCourses shape). */
export const getCategoryCourses = async (
  id: number,
  opts: { search?: string; status?: boolean; page: number; per_page: number; skip: number }
) => {
  const filter = { search: opts.search?.trim() || undefined, status: opts.status };
  const [rows, total] = await Promise.all([
    repo.listCategoryCourses(id, { ...filter, skip: opts.skip, take: opts.per_page }),
    repo.countCategoryCourses(id, filter),
  ]);

  const items = rows.map((c) => ({
    id: String(c.id),
    name: c.name,
    status: c.status,
    orderBy: c.ordered ?? 0,
  }));
  return { items, total };
};
