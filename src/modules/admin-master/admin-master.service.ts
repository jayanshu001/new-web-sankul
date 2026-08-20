import { adminMasterRepository as repo } from "./admin-master.repository";
import { nextOrder } from "../../utils/listOrdering";
import { prisma } from "../../config/prisma";
import { resolveAncestors } from "../../utils/categoryAncestors";
import { matchesAllTokens } from "../../utils/searchFilter";
import { primaryParentMap } from "../../utils/videoCategoryRelation";
import { resyncAllPackageRelations } from "../admin-package/package-relation-sync";

export const ADMIN_MASTER_MODULE = "admin-master";
export const isAdminMasterMysql = (): boolean => true;

export const parseMasterId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const toInt = (v: unknown, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

// ── PackageCourseMaterial (pc-material + master/material; id+title only) ──────
const toPcmDto = (m: any) => ({ _id: String(m.id), title: m.title, createdAt: m.created_at ?? null, updatedAt: m.updated_at ?? null });
export const pcmList = async (q?: { search?: string; skip?: number; take?: number }) => {
  const [rows, total] = await Promise.all([repo.pcmList(q), repo.pcmCount({ search: q?.search })]);
  return { data: rows.map(toPcmDto), total };
};
export const pcmGet = async (id: number) => { const m = await repo.pcmFind(id); return m ? toPcmDto(m) : null; };
export const pcmCreate = async (title: string) => toPcmDto(await repo.pcmCreate(title));
export const pcmUpdate = async (id: number, title: string) => { if (!(await repo.pcmFind(id))) return null; return toPcmDto(await repo.pcmUpdate(id, title)); };
export const pcmDelete = async (id: number) => { if (!(await repo.pcmFind(id))) return false; await repo.pcmDelete(id); return true; };

// ── CourseSubjectCategory ─────────────────────────────────────────────────────
const toSubjDto = (c: any) => ({ _id: String(c.id), title: c.title, slug: c.slug, image: c.image, parent: c.parent, order: c.order, status: c.status, createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null });
export const subjList = async (q?: { search?: string; status?: boolean; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) => {
  const [rows, total] = await Promise.all([repo.subjList(q), repo.subjCount({ search: q?.search, status: q?.status })]);
  return { data: rows.map(toSubjDto), total };
};
export const subjGet = async (id: number) => { const c = await repo.subjFind(id); return c ? toSubjDto(c) : null; };
export const subjCreate = async (d: any) => {
  const parent = toInt(d.parent);
  // No explicit order → previous row + 1 among its siblings (see utils/listOrdering).
  const order = d.order !== undefined && d.order !== null && d.order !== ""
    ? toInt(d.order)
    : nextOrder((await prisma.courseSubjectCategory.findFirst({ where: { parent }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { order: true } }))?.order);
  return toSubjDto(await repo.subjCreate({ title: d.title, slug: d.slug, image: d.image, parent, order, status: d.status ?? true }));
};
export const subjUpdate = async (id: number, d: any) => {
  if (!(await repo.subjFind(id))) return null;
  const data: Record<string, unknown> = {};
  for (const k of ["title", "slug", "image", "status"]) if (d[k] !== undefined) data[k] = d[k];
  if (d.parent !== undefined) data.parent = toInt(d.parent);
  if (d.order !== undefined) data.order = toInt(d.order);
  return toSubjDto(await repo.subjUpdate(id, data));
};
export const subjDelete = async (id: number) => { if (!(await repo.subjFind(id))) return false; await repo.subjDelete(id); return true; };

// ── VideoCategory ──────────────────────────────────────────────────────────────
const toVcDto = (c: any) => ({ _id: String(c.id), title: c.title, slug: c.slug, image: c.image, pdf: c.pdf ?? null, parent: c.parent ?? null, educatorId: c.educatorId ?? null, order_by: c.order_by, status: c.status, createdAt: c.created_at ?? null, updatedAt: c.updated_at ?? null });
/**
 * List with child_categories + hasChildren + ancestors, all resolved from the
 * ws_video_category_relation DAG (edge table) — NOT the legacy `parent` column.
 * `hasChildren` is computed over the full set first, so a category matched by
 * `search` still reports children even when they don't match the query. `search`
 * (title substring) and `limit` are applied afterwards for picker server-search.
 */
export const vcList = async (opts: { search?: string; limit?: number } = {}) => {
  const [all, edges] = await Promise.all([repo.vcList(), repo.vcAllEdges()]);
  const byId = new Map<number, any>(all.map((c) => [c.id, c]));
  // child → primary (deterministic single) parent, for the ancestor chain.
  const primaryParent = primaryParentMap(edges);
  // parent → child rows (deduped per edge), sorted by the child's own order_by.
  const childrenByParent = new Map<number, any[]>();
  const seenPair = new Set<string>();
  for (const e of edges) {
    if (!e.parent || e.parent <= 0) continue;
    const child = byId.get(e.child);
    if (!child) continue;
    const key = `${e.parent}:${e.child}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    (childrenByParent.get(e.parent) ?? childrenByParent.set(e.parent, []).get(e.parent)!).push(
      { _id: String(child.id), title: child.title, slug: child.slug, status: child.status, order_by: child.order_by }
    );
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0));
  // ancestors[{id,name}] root→immediate-parent for greyed parent rows. The full set is
  // already in memory, so resolve against it via the relation-derived primary parent.
  const ancestorsFor = await resolveAncestors(
    all.map((c) => primaryParent.get(c.id) ?? null),
    async (ids) => ids.map((id) => byId.get(id)).filter(Boolean).map((c) => ({ id: c.id, name: c.title, parent: primaryParent.get(c.id) ?? null })),
  );
  let rows = all.map((c) => {
    const children = childrenByParent.get(c.id) ?? [];
    const parent = primaryParent.get(c.id) ?? null;
    return { ...toVcDto({ ...c, parent }), child_categories: children, hasChildren: children.length > 0, ancestors: ancestorsFor(parent) };
  });
  rows = rows.filter((r) => matchesAllTokens(opts.search, [r.title]));
  if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
  return rows;
};
export const vcGet = async (id: number) => { const c = await repo.vcFind(id); return c ? toVcDto(c) : null; };
export const vcCreate = async (d: any) => {
  const parent = d.parent !== undefined ? toInt(d.parent) : 0;
  // No explicit order → previous row + 1 among its siblings (see utils/listOrdering).
  const order = d.order_by !== undefined && d.order_by !== null && d.order_by !== ""
    ? toInt(d.order_by)
    : nextOrder((await prisma.videoCategory.findFirst({ where: { parent }, orderBy: [{ created_at: "desc" }, { id: "desc" }], select: { order_by: true } }))?.order_by);
  const created = await repo.vcCreate({ title: d.title, slug: d.slug, image: d.image, parent, order_by: order, status: d.status ?? true, educatorId: d.educatorId ? toInt(d.educatorId) : 0, pdf: d.pdf ?? "" });
  // Mirror the parent link into the pivot the client catalog reads.
  if (parent > 0) {
    await repo.vcEnsureEdge(parent, created.id, order);
    await resyncAllPackageRelations(); // DAG edge added → refresh package relation cache
  }
  return toVcDto(created);
};
export const vcUpdate = async (id: number, d: any) => {
  if (!(await repo.vcFind(id))) return null;
  const data: Record<string, unknown> = {};
  for (const k of ["title", "slug", "image", "pdf", "status"]) if (d[k] !== undefined) data[k] = d[k];
  if (d.order_by !== undefined) data.order_by = toInt(d.order_by);
  if (d.educatorId !== undefined) data.educatorId = d.educatorId ? toInt(d.educatorId) : 0;
  if (Object.keys(data).length) await repo.vcUpdate(id, data);
  // A parent change syncs BOTH the self-FK and the pivot (edge id preserved on
  // move so package composition links follow). vcSetParent stamps updated_at too.
  if (d.parent !== undefined) {
    await repo.vcSetParent([id], toInt(d.parent));
    await resyncAllPackageRelations(); // DAG edge moved → refresh package relation cache
  }
  const row = await repo.vcFind(id);
  return row ? toVcDto(row) : null;
};
export const vcDelete = async (id: number): Promise<{ ok: boolean; deletedRelations: number }> => {
  if (!(await repo.vcFind(id))) return { ok: false, deletedRelations: 0 };
  // Keep the relation DAG consistent: drop this category's edges, then the row.
  const { count } = await repo.vcDeleteRelations(id);
  await repo.vcDelete(id);
  if (count > 0) await resyncAllPackageRelations(); // DAG edges removed → refresh cache
  return { ok: true, deletedRelations: count };
};

// ════════════════════════════════════════════════════════════════════════════
// FULL admin videoCategory controller (src/admin/videoCategory) — parent-FK based.
// ⚠ Mongo childCategoryIds[] (a DAG) → SQL single `parent` self-FK. On SQL the
// children are derived from each child's `parent`. childCategoryIds IS writable:
// binding it sets each listed child's `parent` to this category (and detaches any
// removed ones back to root). A child can have only one parent (single-parent
// model), so attaching a child here moves it out of any previous parent.
// `duplicate` clones along the single-parent tree (the Mongo DAG collapses to a
// tree on SQL) — see fullVcDuplicate.
// ════════════════════════════════════════════════════════════════════════════
const toFullVcDto = (c: any, children: any[], educator: any | null, ancestors: { id: string; name: string }[] = []) => ({
  id: String(c.id),
  name: c.title,
  slug: c.slug,
  order: c.order_by,
  image: c.image,
  // parent link + ancestor chain (root→immediate-parent) + hasChildren so the picker
  // can render the greyed parent rows for a search match without the whole tree.
  parentId: c.parent && c.parent > 0 ? String(c.parent) : null,
  ancestors,
  hasChildren: children.length > 0,
  child_categories: children.map((cc) => ({ id: String(cc.id), name: cc.title, slug: cc.slug ?? null, status: cc.status, order: cc.order_by ?? 0 })),
  educator: educator ? { id: String(educator.id), name: educator.name } : null,
  status: c.status,
  created_at: c.created_at ?? null,
  updated_at: c.updated_at ?? null,
});

// `primaryParent` (the category's own parent, from ws_video_category_relation) can be
// passed in when the caller already resolved it in a batch (fullVcList); otherwise it
// is looked up here so single-item loads (get/create/update/toggle) stay relation-sourced.
const loadFullVc = async (
  c: any,
  ancestors: { id: string; name: string }[] = [],
  primaryParent?: number | null,
) => {
  const [children, educator] = await Promise.all([
    repo.vcChildren(c.id),
    c.educatorId && c.educatorId > 0 ? repo.educator(c.educatorId) : Promise.resolve(null),
  ]);
  const parent = primaryParent !== undefined ? primaryParent : (await repo.vcPrimaryParents([c.id])).get(c.id) ?? null;
  return toFullVcDto({ ...c, parent }, children, educator, ancestors);
};

export const fullVcList = async (q: { search?: string; status?: string; educatorId?: string; page: number; per_page: number; sort_by: string; sort_dir: string }) => {
  const opts = {
    search: q.search,
    status: q.status === "active" ? true : q.status === "inactive" ? false : undefined,
    educatorId: q.educatorId ? parseMasterId(q.educatorId) ?? undefined : undefined,
    sortBy: q.sort_by, sortDir: (q.sort_dir === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
  const [rows, total] = await Promise.all([
    repo.vcListFiltered({ ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.vcCountFiltered(opts),
  ]);
  // Parent link is sourced from ws_video_category_relation (batched for the page), then
  // ancestors resolve up that same relation via the batched vcCategoriesByIds loader.
  const primaryParent = await repo.vcPrimaryParents(rows.map((r) => r.id));
  const parentOf = (id: number) => primaryParent.get(id) ?? null;
  const ancestorsFor = await resolveAncestors(rows.map((r) => parentOf(r.id)), repo.vcCategoriesByIds);
  const items = await Promise.all(rows.map((c) => loadFullVc(c, ancestorsFor(parentOf(c.id)), parentOf(c.id))));
  return { items, total };
};

export const fullVcPreRequisites = async () => {
  const [cats, educators] = await Promise.all([repo.listAllCategoriesBrief(), repo.listActiveEducators()]);
  return {
    categories: cats.map((c) => ({ id: String(c.id), name: c.title })),
    educators: educators.map((e) => ({ id: String(e.id), name: e.name })),
  };
};

export const fullVcGet = async (id: number) => { const c = await repo.vcFind(id); return c ? loadFullVc(c) : null; };

// Normalize a childCategoryIds payload to a unique list of valid positive ids,
// excluding `selfId` (a category can't be its own child). Returns "child" when
// any id doesn't reference an existing category.
const resolveChildIds = async (raw: any, selfId: number): Promise<number[] | "child"> => {
  const desired = Array.from(
    new Set((Array.isArray(raw) ? raw : []).map((x) => toInt(x)).filter((n) => n > 0 && n !== selfId))
  );
  if (desired.length) {
    const existing = await repo.vcExistingIds(desired);
    if (existing.length !== desired.length) return "child";
  }
  return desired;
};

// Bind `desired` as the full set of children of `parentId`: attach new ones and
// detach (parent → 0) any current child no longer listed.
const reconcileChildren = async (parentId: number, desired: number[]): Promise<void> => {
  const current = (await repo.vcChildren(parentId)).map((c) => c.id);
  const desiredSet = new Set(desired);
  const currentSet = new Set(current);
  const toAttach = desired.filter((id) => !currentSet.has(id));
  const toDetach = current.filter((id) => !desiredSet.has(id));
  if (toAttach.length) await repo.vcSetParent(toAttach, parentId);
  if (toDetach.length) await repo.vcSetParent(toDetach, 0);
  // DAG edges changed (attach/detach) → refresh the package relation cache.
  if (toAttach.length || toDetach.length) await resyncAllPackageRelations();
};

export const fullVcCreate = async (d: any): Promise<{ ok: false; reason: "slug" | "educator" | "child" } | { ok: true; data: any }> => {
  if (await repo.vcSlugTaken(d.slug)) return { ok: false, reason: "slug" };
  if (d.educatorId) { const eid = parseMasterId(String(d.educatorId)); if (!eid || !(await repo.educator(eid))) return { ok: false, reason: "educator" }; }
  // Validate children up-front (-1 = no self yet) so an invalid list never leaves an orphan row.
  let children: number[] = [];
  if (d.childCategoryIds !== undefined) {
    const resolved = await resolveChildIds(d.childCategoryIds, -1);
    if (resolved === "child") return { ok: false, reason: "child" };
    children = resolved;
  }
  const created = await repo.vcCreate({ title: d.name, slug: d.slug, image: d.image, parent: 0, order_by: toInt(d.order), status: d.status ?? true, educatorId: d.educatorId ? toInt(d.educatorId) : 0, pdf: "" });
  if (children.length) await reconcileChildren(created.id, children);
  return { ok: true, data: await loadFullVc(created) };
};

export const fullVcUpdate = async (id: number, d: any): Promise<"not_found" | "slug" | "educator" | "child" | any> => {
  const cat = await repo.vcFind(id);
  if (!cat) return "not_found";
  if (d.slug && d.slug !== cat.slug && (await repo.vcSlugTaken(d.slug, id))) return "slug";
  if (d.educatorId) { const eid = parseMasterId(String(d.educatorId)); if (!eid || !(await repo.educator(eid))) return "educator"; }
  // Validate children before any write so an invalid list doesn't partially apply.
  let children: number[] | null = null;
  if (d.childCategoryIds !== undefined) {
    const resolved = await resolveChildIds(d.childCategoryIds, id);
    if (resolved === "child") return "child";
    children = resolved;
  }
  const data: Record<string, unknown> = {};
  if (d.name !== undefined) data.title = d.name;
  if (d.slug !== undefined) data.slug = d.slug;
  if (d.order !== undefined) data.order_by = toInt(d.order);
  if (d.status !== undefined) data.status = d.status;
  if (d.image !== undefined && d.image) data.image = d.image;
  if (d.educatorId !== undefined) data.educatorId = d.educatorId ? toInt(d.educatorId) : 0;
  await repo.vcUpdate(id, data);
  if (children !== null) await reconcileChildren(id, children);
  return loadFullVc(await repo.vcFind(id));
};

export const fullVcDelete = async (id: number): Promise<"not_found" | "in_use" | "ok"> => {
  if (!(await repo.vcFind(id))) return "not_found";
  const [vid, child] = await Promise.all([repo.videoInCategory(id), repo.hasChildren(id)]);
  if (vid || child) return "in_use";
  // Drop any relation-DAG edges before the row so no dangling edge survives.
  await repo.vcDeleteRelations(id);
  await repo.vcDelete(id);
  await resyncAllPackageRelations(); // DAG edges removed → refresh the package relation cache
  return "ok";
};

export const fullVcToggle = async (id: number): Promise<boolean | null> => {
  const c = await repo.vcFind(id);
  if (!c) return null;
  const updated = await repo.vcUpdate(id, { status: !c.status });
  return updated.status;
};

export const fullVcCategoryExists = async (id: number) => !!(await repo.vcFind(id));

// Clone a category + its parent-tree descendants + their videos. Returns
// "not_found" or the DTO the controller responds with (id as string, matching the
// prior Mongo ObjectId shape).
export const fullVcDuplicate = async (
  id: number
): Promise<
  | "not_found"
  | { id: string; name: string; courseId: null; liveCourseId: null; createdAt: Date; itemsCloned: { subCategories: number; videos: number } }
> => {
  const result = await repo.vcDuplicate(id);
  if (!result) return "not_found";
  await resyncAllPackageRelations(); // cloned subtree added new DAG edges → refresh cache
  return {
    id: String(result.rootId),
    name: result.rootTitle,
    courseId: null,
    liveCourseId: null,
    createdAt: new Date(),
    itemsCloned: { subCategories: result.subCategories, videos: result.videos },
  };
};

export const listCategorySubCategories = async (categoryId: number, q: { search?: string; status?: string; page: number; per_page: number }) => {
  const opts = { search: q.search, status: q.status === "active" ? true : q.status === "inactive" ? false : undefined };
  const [rows, total] = await Promise.all([
    repo.subCategoriesForCategory(categoryId, { ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.countSubCategoriesForCategory(categoryId, opts),
  ]);
  return { items: rows.map((c) => ({ id: String(c.id), name: c.title, slug: c.slug, status: c.status, orderBy: c.order_by ?? 0 })), total };
};

/** Kinds the category "Courses & Packages" tab can list. */
export type CategoryAttachmentType = "course" | "live-course" | "package";

export interface CategoryAttachment {
  id: string;
  /** Nullable: ws_course.name is a nullable column and the pre-union response
   *  already passed a null through. Not coerced to "" — that would be a contract
   *  change on the one kind that was already shipping. */
  name: string | null;
  /** Required on EVERY row. The FE defaults a missing/unknown value to "course",
   *  so an unlabelled live course or package would be silently mislabelled — and
   *  it routes both the detail link and the status toggle off this field.
   *  Hyphenated `live-course` matches /admin/materials/categories/:id/products. */
  type: CategoryAttachmentType;
  status: boolean;
  orderBy: number;
}

/**
 * Everything attached to a video category: recorded Courses, Live Courses and
 * Packages, as ONE paginated list.
 *
 * WHY ONE ENDPOINT: three separately-paginated lists cannot be merged into a single
 * page client-side without lying about `total` and dropping rows at page edges.
 *
 * The union is built and paged IN SQL (see buildCategoryAttachmentsQuery) — the same
 * shape `/admin/materials/categories/:id/products` uses. Paging it in application
 * code would be wrong: each source would get its own offset.
 */
export const listCategoryCourses = async (
  categoryId: number,
  q: { search?: string; status?: string; type?: CategoryAttachmentType; page: number; per_page: number }
): Promise<{ items: CategoryAttachment[]; total: number }> => {
  const opts = {
    search: q.search,
    status: q.status === "active" ? true : q.status === "inactive" ? false : undefined,
    type: q.type,
  };

  const [rows, total] = await Promise.all([
    repo.categoryAttachments(categoryId, { ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.countCategoryAttachments(categoryId, opts),
  ]);

  return {
    // `id` stays the id within its OWN table — course 7 and live course 7 both
    // exist, and the FE keys rows by `type:id`. Deliberately NOT namespaced.
    // A raw query returns MySQL TINYINT(1) as 0/1, so `status` is normalised back
    // to a real boolean here — Prisma would have done it for a typed model read.
    items: rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      type: r.type as CategoryAttachmentType,
      status: Boolean(r.status),
      orderBy: Number(r.order_by ?? 0),
    })),
    total,
  };
};

export const listCategoryVideos = async (categoryId: number, q: { search?: string; status?: string; platform?: string; page: number; per_page: number }) => {
  const opts = { search: q.search, status: q.status === "active" ? true : q.status === "inactive" ? false : undefined, platform: q.platform };
  const [rows, total] = await Promise.all([
    repo.videosForCategory(categoryId, { ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.countVideosForCategory(categoryId, opts),
  ]);
  return { items: rows.map((v) => ({ id: String(v.id), name: v.title ?? null, slug: v.slug ?? null, status: v.status, orderBy: v.order ?? 0, platform: v.platform ?? null })), total };
};
