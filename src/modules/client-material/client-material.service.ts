// Client materials: category browsing, entitlement checks and download tracking.
/**
 * Entitlement: a paid material is owned if the customer holds an active sub to a
 * course/package/live-course whose material-category pivot points at the material's
 * category OR any ancestor. For live courses the pivot is ws_material_category_live_course
 * (admin-live-course keeps it in sync with the ws_live_course.material_categories JSON,
 * which stays the admin shape).
 */
import { prisma } from "../../config/prisma";
import { selfFkDescendantsByRoot } from "../catalog-category-tree/category-tree.service";
import { signMediaToken } from "../../utils/mediaToken";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

/**
 * `null` when not accessible (unpurchased paid item, or no customer). The raw `file` /
 * `direct_link` never leaves the server; POST /client/media/resolve exchanges the token.
 * Paid materials carry a `trusted` scope, and resolve re-checks ownership itself.
 */
export const materialMediaToken = (
  materialId: number,
  accessible: boolean,
  isPaid: boolean,
  customerId: number | null,
): string | null => {
  if (customerId == null || !accessible) return null;
  return isPaid
    ? signMediaToken({ k: "material", id: materialId, scope: { kind: "trusted" }, cust: customerId })
    : signMediaToken({ k: "material", id: materialId, free: true, cust: customerId });
};

export const parseMatId = parsePositiveInt;

/** One positive-int query param: null = absent, "invalid" = present but unusable. */
const parseScopeId = (raw: unknown): number | null | "invalid" => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (Array.isArray(raw)) return "invalid";
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
};

/**
 * Accepts exactly one of `?courseId` / `?packageId` / `?liveCourseId`.
 *
 *   `null`       — none present ⇒ unscoped (global OR), the documented default
 *   scope object — the single entry point the user navigated from
 *   `"invalid"`  — present but not a positive int ⇒ caller MUST 400
 *   `"multiple"` — more than one given ⇒ caller MUST 400 (guessing would invent an answer)
 *
 * Treating `?courseId=abc` (or a repeated param) as "no scope" would widen access on a typo,
 * the exact failure scoping exists to prevent.
 */
export const parseEntitlementScope = (
  query: Record<string, unknown>
): MaterialEntitlementScope | "invalid" | "multiple" => {
  const course = parseScopeId(query.courseId);
  const pkg = parseScopeId(query.packageId);
  const live = parseScopeId(query.liveCourseId);
  if (course === "invalid" || pkg === "invalid" || live === "invalid") return "invalid";

  const given = [course, pkg, live].filter((v) => v != null).length;
  if (given > 1) return "multiple";
  if (course != null) return { kind: "course", id: course };
  if (pkg != null) return { kind: "package", id: pkg };
  if (live != null) return { kind: "liveCourse", id: live };
  return null;
};

/**
 * Ancestors (inclusive) via the single-parent tree. Roots use `parent = 0`, not NULL, so
 * `parent > 0` is required: otherwise a single `mcategory_id = 0` pivot row would unlock every
 * root-level material for everyone who owns that container.
 */
const ancestorsInclusive = async (categoryIds: number[]): Promise<Map<number, Set<number>>> => {
  const out = new Map<number, Set<number>>();
  for (const leaf of categoryIds) {
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `WITH RECURSIVE chain (id) AS (SELECT ${leaf} UNION SELECT c.parent FROM ws_material_category c JOIN chain ch ON c.id = ch.id WHERE c.parent IS NOT NULL AND c.parent > 0) SELECT DISTINCT id FROM chain`
    );
    out.set(leaf, new Set(rows.map((r) => Number(r.id))));
  }
  return out;
};

/** All category ids reachable from a leaf upward (union across the batch). */
const categoryUniverse = async (categoryIds: number[]): Promise<{ universe: Set<number>; byLeaf: Map<number, Set<number>> }> => {
  const byLeaf = await ancestorsInclusive(categoryIds);
  const universe = new Set<number>();
  for (const set of byLeaf.values()) for (const id of set) universe.add(id);
  return { universe, byLeaf };
};

export type MatLite = { _id: number; materialCategoryId: number; isPaid: boolean };

/**
 * The ONE container the client navigated from. A category can be attached to many
 * containers, so owning Course 1 must not mark a material purchased while the student views
 * it inside unpurchased Live Course 3. All three kinds are scopeable since all three can share
 * a category. `null` = unscoped global OR, used by the standalone Study-Material tab.
 */
export type MaterialEntitlementScope =
  | { kind: "course"; id: number }
  | { kind: "package"; id: number }
  | { kind: "liveCourse"; id: number }
  | null;

/**
 * Owned paid material ids for a batch. With a `scope`, only that container can grant access
 * (the other pivots are not consulted), so scoping can only withhold access, never widen it.
 */
export const getPurchasedMaterialIds = async (
  customerId: number | null,
  materials: MatLite[],
  scope: MaterialEntitlementScope = null
): Promise<Set<number>> => {
  const owned = new Set<number>();
  if (!customerId) return owned;
  const paid = materials.filter((m) => m.isPaid);
  if (!paid.length) return owned;

  const leafIds = [...new Set(paid.map((m) => m.materialCategoryId).filter((n) => n != null))];
  const { universe, byLeaf } = await categoryUniverse(leafIds);
  const universeIds = [...universe];
  if (!universeIds.length) return owned;

  const wants = (kind: "course" | "package" | "liveCourse") => scope == null || scope.kind === kind;
  const only = (kind: "course" | "package" | "liveCourse") => (scope?.kind === kind ? scope.id : undefined);
  const [courseRefs, packageRefs, liveRefs] = await Promise.all([
    wants("course")
      ? prisma.materialCategoryCourse.findMany({ where: { materialCategoryId: { in: universeIds }, ...(only("course") != null ? { courseId: only("course") } : {}) }, select: { courseId: true, materialCategoryId: true } })
      : [],
    wants("package")
      ? prisma.materialCategoryPackage.findMany({ where: { materialCategoryId: { in: universeIds }, ...(only("package") != null ? { packageId: only("package") } : {}) }, select: { packageId: true, materialCategoryId: true } })
      : [],
    wants("liveCourse")
      ? prisma.materialCategoryLiveCourse.findMany({ where: { materialCategoryId: { in: universeIds }, ...(only("liveCourse") != null ? { liveCourseId: only("liveCourse") } : {}) }, select: { liveCourseId: true, materialCategoryId: true } })
      : [],
  ]);
  const courseIds = [...new Set(courseRefs.map((r) => r.courseId).filter((n): n is number => n != null))];
  const packageIds = [...new Set(packageRefs.map((r) => r.packageId).filter((n): n is number => n != null))];
  const liveCourseIds = [...new Set(liveRefs.map((r) => r.liveCourseId))];

  const now = new Date();
  const [ownedCourses, ownedPackages, ownedLiveCourses] = await Promise.all([
    courseIds.length ? prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { in: courseIds }, status: true, OR: [{ endAt: null }, { endAt: { gte: now } }] }, select: { courseId: true } }) : [],
    packageIds.length ? prisma.packageCourseSubscription.findMany({ where: { customerId, packageId: { in: packageIds }, status: true, OR: [{ endAt: null }, { endAt: { gte: now } }] }, select: { packageId: true } }) : [],
    // Same live-course predicate as everywhere else: active, null endAt = lifetime.
    liveCourseIds.length ? prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: liveCourseIds }, status: true, OR: [{ endAt: null }, { endAt: { gte: now } }] }, select: { liveCourseId: true } }) : [],
  ]);
  const ownedCourseSet = new Set(ownedCourses.map((r) => r.courseId!));
  const ownedPackageSet = new Set(ownedPackages.map((r) => r.packageId!));
  const ownedLiveCourseSet = new Set(ownedLiveCourses.map((r) => r.liveCourseId));

  const unlocked = new Set<number>();
  for (const r of courseRefs) if (r.courseId != null && ownedCourseSet.has(r.courseId) && r.materialCategoryId != null) unlocked.add(r.materialCategoryId);
  for (const r of packageRefs) if (r.packageId != null && ownedPackageSet.has(r.packageId) && r.materialCategoryId != null) unlocked.add(r.materialCategoryId);
  for (const r of liveRefs) if (ownedLiveCourseSet.has(r.liveCourseId)) unlocked.add(r.materialCategoryId);

  for (const m of paid) {
    const chain = byLeaf.get(m.materialCategoryId);
    if (!chain) continue;
    for (const cat of chain) { if (unlocked.has(cat)) { owned.add(m._id); break; } }
  }
  return owned;
};

/**
 * Raw `file` / `directLink` are never emitted; `mediaToken` (null for unpurchased paid)
 * replaces them. `isDirectLink` tells the client whether to open externally or in-app.
 */
export const shapeMaterial = (m: any, ownedIds: Set<number>, customerId: number | null = null) => {
  const isPaid = !!m.isPaid;
  const isPurchased = !isPaid || ownedIds.has(m.id);
  const isDirectLink = !m.file && !!m.direct_link;
  return {
    _id: String(m.id),
    title: m.name ?? "",
    description: m.description ?? null,
    thumbnail: m.thumbnail ?? null,
    materialCategoryId: m.materialCategoryId != null ? String(m.materialCategoryId) : null,
    fileSize: m.fileSize != null ? Number(m.fileSize) : null,
    language: m.language ?? null,
    isPreview: !!m.isPreview,
    isPaid,
    isPurchased,
    order: m.order_by,
    createdAt: m.created_at ?? null,
    file: "",
    directLink: "",
    isDirectLink,
    mediaToken: materialMediaToken(m.id, isPurchased, isPaid, customerId),
    downloadCount: m.downloadCount ?? 0,
  };
};

const MAT_SELECT = {
  id: true, name: true, description: true, thumbnail: true, materialCategoryId: true,
  file: true, direct_link: true, fileSize: true, language: true, isPreview: true,
  isPaid: true, order_by: true, downloadCount: true, created_at: true,
} as const;

const toLite = (m: any): MatLite => ({ _id: m.id, materialCategoryId: m.materialCategoryId, isPaid: !!m.isPaid });

const toScope = (scope?: MaterialEntitlementScope): MaterialEntitlementScope =>
  scope && Number.isInteger(scope.id) && scope.id > 0 ? scope : null;

export const findCategory = (id: number) =>
  prisma.materialCategory.findFirst({ where: { id, status: true }, select: { id: true, name: true, image: true, parent: true } });

// Category node: child subjects, breadcrumbs and a page of its own leaf materials.
export const getCategoryContents = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip?: number; take?: number; search?: string | null; scope?: MaterialEntitlementScope } = {}
) => {
  const current = await findCategory(categoryId);
  if (!current) return null;

  const children = await prisma.materialCategory.findMany({ where: { parent: categoryId, status: true }, select: { id: true, name: true, image: true, order_by: true }, orderBy: [{ order_by: "asc" }, { created_at: "asc" }] });
  // Batched: one subtree CTE + three groupBys for all children (was 5 queries per child).
  // A folder counts every active material in its subtree and is "newly added" when any
  // was created in the last 10 days; summing per category is exact because a material
  // belongs to one category.
  const childIds = children.map((c) => c.id);
  const subtreeByChild = await selfFkDescendantsByRoot("ws_material_category", "parent", childIds);
  const union = [...new Set([...subtreeByChild.values()].flat())];
  const cutoff = new Date(Date.now() - 10 * 86_400_000);
  const [grandRows, countRows, newRows] = childIds.length
    ? await Promise.all([
        prisma.materialCategory.groupBy({ by: ["parent"], where: { parent: { in: childIds }, status: true }, _count: { _all: true } }),
        prisma.material.groupBy({ by: ["materialCategoryId"], where: { materialCategoryId: { in: union }, status: true }, _count: { _all: true } }),
        prisma.material.groupBy({ by: ["materialCategoryId"], where: { materialCategoryId: { in: union }, status: true, created_at: { gt: cutoff } }, _count: { _all: true } }),
      ])
    : [[], [], []];
  const tally = (rows: { materialCategoryId: number | null; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.materialCategoryId as number, r._count._all]));
  const perCat = tally(countRows);
  const newPerCat = tally(newRows);
  const grandByParent = new Map(grandRows.map((r) => [r.parent, r._count._all]));
  const subjects = children.map((c) => {
    const subtree = subtreeByChild.get(c.id) ?? [c.id];
    const count = subtree.reduce((n, id) => n + (perCat.get(id) ?? 0), 0);
    const isNewlyAdded = subtree.some((id) => (newPerCat.get(id) ?? 0) > 0);
    return { _id: String(c.id), title: c.name, image: c.image, order: c.order_by, havingChildDirectory: (grandByParent.get(c.id) ?? 0) > 0, count, isNewlyAdded };
  });

  // Only leaf materials are paginated; `subjects` + breadcrumbs are node metadata.
  const matsWhere: any = { materialCategoryId: categoryId, status: true };
  const matsSearch = buildPrismaSearch(opts.search, ["name"]);
  if (matsSearch) matsWhere.AND = matsSearch.AND;
  const [matsRaw, materialsTotal] = await Promise.all([
    prisma.material.findMany({ where: matsWhere, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take, select: MAT_SELECT }),
    prisma.material.count({ where: matsWhere }),
  ]);
  const ownedIds = await getPurchasedMaterialIds(customerId, matsRaw.map(toLite), toScope(opts.scope));
  const materials = matsRaw.map((m) => shapeMaterial(m, ownedIds, customerId));

  const chainRows = await prisma.$queryRawUnsafe<{ id: number; title: string | null; depth: number }[]>(
    `WITH RECURSIVE chain (id, title, parent, depth) AS (
       SELECT id, title, parent, 0 FROM ws_material_category WHERE id = ${categoryId}
       UNION
       SELECT c.id, c.title, c.parent, ch.depth+1 FROM ws_material_category c JOIN chain ch ON c.id = ch.parent
     ) SELECT id, title, depth FROM chain ORDER BY depth DESC`
  );
  const breadcrumbs = chainRows.map((r) => ({ _id: String(r.id), title: r.title }));

  return { current: { _id: String(current.id), title: current.name, image: current.image }, breadcrumbs, subjects, materials, materialsTotal };
};

/** GET /client/material-categories/:id/materials. `type` = `?type=free|paid`. */
export const listMaterialsByCategoryPaged = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip: number; take: number; search?: string | null; type?: "free" | "paid" | null; scope?: MaterialEntitlementScope }
) => {
  const category = await findCategory(categoryId);
  if (!category) return null;

  const where: Prisma.MaterialWhereInput = { materialCategoryId: categoryId, status: true };
  const search = buildPrismaSearch(opts.search, ["name"]);
  if (search) where.AND = search.AND;
  if (opts.type === "free") where.isPaid = false;
  else if (opts.type === "paid") where.isPaid = true;

  const [matsRaw, total] = await Promise.all([
    prisma.material.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take, select: MAT_SELECT }),
    prisma.material.count({ where }),
  ]);
  const ownedIds = await getPurchasedMaterialIds(customerId, matsRaw.map(toLite), toScope(opts.scope));
  const list = matsRaw.map((m) => shapeMaterial(m, ownedIds, customerId));

  return { category: { _id: String(category.id), title: category.name, image: category.image }, list, total };
};

/**
 * Scope matters here as much as on the list: this is the mediaToken-refresh path, so an
 * unscoped call would mint a token for a material opened from a live course never bought.
 */
export const getMaterialDetail = async (materialId: number, customerId: number | null, scope?: MaterialEntitlementScope) => {
  const m = await prisma.material.findFirst({ where: { id: materialId, status: true }, select: { ...MAT_SELECT, MaterialCategory: { select: { id: true, name: true } } } });
  if (!m) return null;
  const ownedIds = await getPurchasedMaterialIds(customerId, [toLite(m)], toScope(scope));
  const shaped = shapeMaterial(m, ownedIds, customerId);
  (shaped as any).materialCategoryId = m.MaterialCategory ? { _id: String(m.MaterialCategory.id), title: m.MaterialCategory.name } : (m.materialCategoryId != null ? String(m.materialCategoryId) : null);
  return shaped;
};

// Increments the download counter; null if the material doesn't exist.
export const trackDownload = async (materialId: number) => {
  const exists = await prisma.material.findFirst({ where: { id: materialId }, select: { id: true } });
  if (!exists) return null;
  const row = await prisma.material.update({ where: { id: materialId }, data: { downloadCount: { increment: 1 } }, select: { id: true, downloadCount: true } });
  return { _id: String(row.id), downloadCount: row.downloadCount };
};

export const getRecentMaterials = async (
  customerId: number | null,
  days: number,
  opts: { skip: number; take: number; search?: string | null }
) => {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const where: Prisma.MaterialWhereInput = { status: true, created_at: { gt: cutoff } };
  const search = buildPrismaSearch(opts.search, ["name"]);
  if (search) where.AND = search.AND;
  const [matsRaw, total] = await Promise.all([
    prisma.material.findMany({
      where,
      orderBy: { created_at: "desc" }, skip: opts.skip, take: opts.take,
      select: { ...MAT_SELECT, MaterialCategory: { select: { id: true, name: true } } },
    }),
    prisma.material.count({ where }),
  ]);
  const ownedIds = await getPurchasedMaterialIds(customerId, matsRaw.map(toLite));
  const materials = matsRaw.map((m) => {
    const shaped = shapeMaterial(m, ownedIds, customerId);
    (shaped as any).materialCategoryId = m.MaterialCategory ? { _id: String(m.MaterialCategory.id), title: m.MaterialCategory.name } : null;
    return shaped;
  });
  return { materials, total };
};
