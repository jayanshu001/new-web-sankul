import { isMysqlModule } from "../../config/migration";
import { adminMasterRepository as repo } from "./admin-master.repository";

export const ADMIN_MASTER_MODULE = "admin-master";
export const isAdminMasterMysql = (): boolean => isMysqlModule(ADMIN_MASTER_MODULE);

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
export const pcmList = async () => (await repo.pcmList()).map(toPcmDto);
export const pcmGet = async (id: number) => { const m = await repo.pcmFind(id); return m ? toPcmDto(m) : null; };
export const pcmCreate = async (title: string) => toPcmDto(await repo.pcmCreate(title));
export const pcmUpdate = async (id: number, title: string) => { if (!(await repo.pcmFind(id))) return null; return toPcmDto(await repo.pcmUpdate(id, title)); };
export const pcmDelete = async (id: number) => { if (!(await repo.pcmFind(id))) return false; await repo.pcmDelete(id); return true; };

// ── CourseSubjectCategory ─────────────────────────────────────────────────────
const toSubjDto = (c: any) => ({ _id: String(c.id), title: c.title, slug: c.slug, image: c.image, parent: c.parent, order: c.order, status: c.status, createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null });
export const subjList = async (q?: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) => {
  const [rows, total] = await Promise.all([repo.subjList(q), repo.subjCount({ search: q?.search })]);
  return { data: rows.map(toSubjDto), total };
};
export const subjCreate = async (d: any) => toSubjDto(await repo.subjCreate({ title: d.title, slug: d.slug, image: d.image, parent: toInt(d.parent), order: toInt(d.order), status: d.status ?? true }));
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
/** List with child_categories (resolved via the `parent` self-FK) + hasChildren. */
export const vcList = async () => {
  const all = await repo.vcList();
  const childrenByParent = new Map<number, any[]>();
  for (const c of all) {
    if (c.parent != null && c.parent > 0) {
      (childrenByParent.get(c.parent) ?? childrenByParent.set(c.parent, []).get(c.parent)!).push(
        { _id: String(c.id), title: c.title, slug: c.slug, status: c.status, order_by: c.order_by }
      );
    }
  }
  return all.map((c) => {
    const children = childrenByParent.get(c.id) ?? [];
    return { ...toVcDto(c), child_categories: children, hasChildren: children.length > 0 };
  });
};
export const vcCreate = async (d: any) => toVcDto(await repo.vcCreate({ title: d.title, slug: d.slug, image: d.image, parent: d.parent !== undefined ? toInt(d.parent) : 0, order_by: toInt(d.order_by), status: d.status ?? true, educatorId: d.educatorId ? toInt(d.educatorId) : 0, pdf: d.pdf ?? "" }));
export const vcUpdate = async (id: number, d: any) => {
  if (!(await repo.vcFind(id))) return null;
  const data: Record<string, unknown> = {};
  for (const k of ["title", "slug", "image", "pdf", "status"]) if (d[k] !== undefined) data[k] = d[k];
  if (d.parent !== undefined) data.parent = toInt(d.parent);
  if (d.order_by !== undefined) data.order_by = toInt(d.order_by);
  if (d.educatorId !== undefined) data.educatorId = d.educatorId ? toInt(d.educatorId) : 0;
  return toVcDto(await repo.vcUpdate(id, data));
};
export const vcDelete = async (id: number) => { if (!(await repo.vcFind(id))) return false; await repo.vcDelete(id); return true; };

// ════════════════════════════════════════════════════════════════════════════
// FULL admin videoCategory controller (src/admin/videoCategory) — parent-FK based.
// ⚠ Mongo childCategoryIds[] (a DAG) → SQL single `parent` self-FK. On SQL the
// children are derived from each child's `parent`. childCategoryIds IS writable:
// binding it sets each listed child's `parent` to this category (and detaches any
// removed ones back to root). A child can have only one parent (single-parent
// model), so attaching a child here moves it out of any previous parent.
// `duplicate` (DAG clone) stays on Mongo.
// ════════════════════════════════════════════════════════════════════════════
const toFullVcDto = (c: any, children: any[], educator: any | null) => ({
  id: String(c.id),
  name: c.title,
  slug: c.slug,
  order: c.order_by,
  image: c.image,
  child_categories: children.map((cc) => ({ id: String(cc.id), name: cc.title, slug: cc.slug ?? null, status: cc.status, order: cc.order_by ?? 0 })),
  educator: educator ? { id: String(educator.id), name: educator.name } : null,
  status: c.status,
  created_at: c.created_at ?? null,
  updated_at: c.updated_at ?? null,
});

const loadFullVc = async (c: any) => {
  const [children, educator] = await Promise.all([
    repo.vcChildren(c.id),
    c.educatorId && c.educatorId > 0 ? repo.educator(c.educatorId) : Promise.resolve(null),
  ]);
  return toFullVcDto(c, children, educator);
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
  const items = await Promise.all(rows.map(loadFullVc));
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
  await repo.vcDelete(id);
  return "ok";
};

export const fullVcToggle = async (id: number): Promise<boolean | null> => {
  const c = await repo.vcFind(id);
  if (!c) return null;
  const updated = await repo.vcUpdate(id, { status: !c.status });
  return updated.status;
};

export const fullVcCategoryExists = async (id: number) => !!(await repo.vcFind(id));

export const listCategoryCourses = async (categoryId: number, q: { search?: string; status?: string; page: number; per_page: number }) => {
  const opts = { search: q.search, status: q.status === "active" ? true : q.status === "inactive" ? false : undefined };
  const [rows, total] = await Promise.all([
    repo.coursesForCategory(categoryId, { ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.countCoursesForCategory(categoryId, opts),
  ]);
  return { items: rows.map((c) => ({ id: String(c.id), name: c.name, status: c.status, orderBy: c.ordered ?? 0 })), total };
};

export const listCategoryVideos = async (categoryId: number, q: { search?: string; status?: string; platform?: string; page: number; per_page: number }) => {
  const opts = { search: q.search, status: q.status === "active" ? true : q.status === "inactive" ? false : undefined, platform: q.platform };
  const [rows, total] = await Promise.all([
    repo.videosForCategory(categoryId, { ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.countVideosForCategory(categoryId, opts),
  ]);
  return { items: rows.map((v) => ({ id: String(v.id), name: v.title ?? null, slug: v.slug ?? null, status: v.status, orderBy: v.order ?? 0, platform: v.platform ?? null })), total };
};
