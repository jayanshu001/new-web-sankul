// Exam categories: client directory reads and admin category CRUD.
import { catalogExamRepository as repo } from "./catalog-exam.repository";
import type { CategoryCourseType } from "./catalog-exam.repository";
import { toExamCategoryDto } from "./catalog-exam.transformer";
import { resolveAncestors } from "../../utils/categoryAncestors";
import type {
  ExamCategoryChildrenResult,
  ExamCategoryDto,
} from "./catalog-exam.types";

export const parseExamCategoryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const findCategoryById = async (id: number): Promise<ExamCategoryDto | null> => {
  const row = await repo.findCategoryById(id);
  return row ? toExamCategoryDto(row) : null;
};

// Active children of a category, paged; null if the parent is missing.
export const getCategoryChildren = async (
  parentId: number,
  search?: string,
  paging?: { skip?: number; take?: number }
): Promise<ExamCategoryChildrenResult | null> => {
  const parentRow = await repo.findCategoryById(parentId);
  if (!parentRow) return null;

  const searchOpt = search?.trim() || undefined;
  const [children, total] = await Promise.all([
    repo.listActiveChildren(parentId, { search: searchOpt, skip: paging?.skip, take: paging?.take }),
    repo.countActiveChildren(parentId, { search: searchOpt }),
  ]);

  const childIds = children.map((c) => c.id);
  const [examCounts, childCountRows] = await Promise.all([
    Promise.all(childIds.map((cid) => repo.countExams(cid))),
    repo.childCountsByParent(childIds),
  ]);
  const childFolderCount = new Map(childCountRows.map((r) => [r.parent, r._count._all]));

  const list = children.map((c, i) => {
    const folders = childFolderCount.get(c.id) ?? 0;
    const havingChildDirectory = folders > 0;
    // Catalog contract: a directory reports its child-folder count, a leaf its own test count.
    const count = havingChildDirectory ? folders : examCounts[i];
    return {
      category: { ...toExamCategoryDto(c), count, havingChildDirectory },
    };
  });

  return { parent: toExamCategoryDto(parentRow), list, total };
};

// Admin/client category reads keep the legacy key names (`parentId`, `orderBy`).
// The root sentinel `parent_id = 0` is emitted as `parentId: null`.

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

/** Newest-created first. */
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
  // Flag non-leaf rows so pickers can restrict selection to leaves even when a
  // parent's children are absent from this filtered/paginated page.
  const parents = await repo.childParentIds(rows.map((r) => r.id));
  const withChildren = new Set(parents.map((p) => p.parent));
  // ancestors[{id,name}] (root → immediate parent) let a search-filtered picker
  // render the greyed parent rows without the whole tree.
  const ancestorsFor = await resolveAncestors(rows.map((r) => r.parent), repo.categoriesByIds);
  return rows.map((row) => ({
    ...toExamCategoryDoc(row),
    hasChildren: withChildren.has(row.id),
    ancestors: ancestorsFor(row.parent),
  }));
};

export const countCategories = (input: ListCategoriesInput): Promise<number> => {
  const { parentRoot, parentNum } = resolveParentFilter(input.parentId);
  return repo.countCategories({
    parentRoot,
    parentId: parentNum,
    search: input.search?.trim() || undefined,
    status: input.status,
  });
};

/** Always status=true; returns only the fields the client list renders. */
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

// Full active category tree, nested under `children`.
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

export const categoryExists = async (id: number): Promise<boolean> =>
  Boolean(await repo.findCategoryById(id));

// Single-parent tree; the root sentinel is parent_id = 0.

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
    // Defaults to after the last category overall: the admin list is flat across
    // levels and order_by is one table-wide sequence.
    order_by: input.orderBy ?? (await repo.maxCategoryOrder()) + 1,
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
  // null clears the image (orphaning the old object); a new URL replaces it.
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

// Soft delete; refused while the category has children or exams.
export const deleteCategory = async (id: number): Promise<"not_found" | "has_children" | "has_exams" | true> => {
  if (!(await repo.findCategoryById(id))) return "not_found";
  if ((await repo.childCount(id)) > 0) return "has_children";
  if ((await repo.examCountForCategory(id)) > 0) return "has_exams";
  await repo.softDeleteCategory(id);
  return true;
};

// Linked packages, each priced by its default plan (else the lowest).
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

/**
 * Courses and live courses as one set, paged in SQL so `total` and page edges
 * stay correct. Packages are excluded: the category page has its own Package tab.
 */
export const getCategoryCourses = async (
  id: number,
  opts: {
    search?: string;
    status?: boolean;
    type?: CategoryCourseType;
    page: number;
    per_page: number;
    skip: number;
  }
) => {
  const filter = { search: opts.search?.trim() || undefined, status: opts.status, type: opts.type };
  const [rows, total] = await Promise.all([
    repo.listCategoryCourses(id, { ...filter, skip: opts.skip, take: opts.per_page }),
    repo.countCategoryCourses(id, filter),
  ]);

  const items = rows.map((c) => ({
    // The id within its own table: course 7 and live course 7 both exist; the FE keys rows by `type-id`.
    id: String(c.id),
    name: c.name,
    // Required on every row: the FE defaults a missing type to "course".
    type: c.type,
    // Raw SQL returns TINYINT 0/1.
    status: Boolean(c.status),
    orderBy: c.order_by ?? 0,
  }));
  return { items, total };
};
