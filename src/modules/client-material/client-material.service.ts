/**
 * Client material reads + entitlement — SQL branch. Gated behind
 * `isMysqlModule("client-material")`. Reads ws_material + ws_material_category +
 * the ws_material_category_(course|package) pivots + subscriptions.
 *
 * Entitlement: a paid material is owned if the customer holds an active sub to a
 * course/package/live-course whose material-category pivot points at the
 * material's category OR any ancestor.
 * 2026-07-31: live course joined the other two. It previously had no SQL pivot
 * (Wave-6 drift — attachments lived only in the ws_live_course.material_categories
 * JSON), so a verified live-course buyer got isPurchased:false + mediaToken:null
 * on every material. The pivot ws_material_category_live_course now carries the
 * attachments for entitlement; admin-live-course keeps it in sync with the JSON.
 *
 * ws_material was extended 2026-06-19 (+description/thumbnail/file_size/file_mime/
 * language/is_preview/is_paid/download_count) so the client shape has parity.
 */
import { prisma } from "../../config/prisma";
import { signMediaToken } from "../../utils/mediaToken";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const CLIENT_MATERIAL_MODULE = "client-material";
export const isClientMaterialMysql = (): boolean => true;

/**
 * Mint a material media token, or `null` when the material is NOT accessible
 * (unpurchased paid item, or no authenticated customer). The raw `file` /
 * `direct_link` URL NEVER leaves the server — the client exchanges this opaque
 * token at POST /client/media/resolve, which re-verifies entitlement and returns
 * a short-lived URL (presigned for Spaces objects, passthrough for external
 * direct links). Same contract as video/ebook/audio-note tokens.
 *
 * Paid materials carry a `trusted` scope; resolve independently re-checks
 * ownership for `k:"material"` via getPurchasedMaterialIds, so the token can't
 * outlive an expired subscription beyond its short TTL. Free materials get a
 * `free` token (no entitlement check).
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

export const parseMatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** One positive-int query param: null = absent, "invalid" = present but unusable. */
const parseScopeId = (raw: unknown): number | null | "invalid" => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (Array.isArray(raw)) return "invalid";
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
};

/**
 * Parse the entitlement scope off a query string. Accepts exactly one of
 * `?courseId` / `?packageId` / `?liveCourseId`.
 *
 *   `null`       — none present ⇒ unscoped (global OR), the documented default
 *   scope object — the single entry point the user navigated from
 *   `"invalid"`  — a value is present but not a positive int ⇒ caller MUST 400
 *   `"multiple"` — more than one given ⇒ caller MUST 400; the user came from ONE
 *                  place, and guessing which would be inventing an answer
 *
 * `"invalid"` exists on purpose: silently treating `?courseId=abc` as "no scope"
 * would WIDEN access on a typo, which is the exact failure scoping was added to
 * prevent. A repeated param (`?courseId=1&courseId=2`) is invalid for the same reason.
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
 * Ancestors (inclusive) of a material category via the single-parent tree.
 *
 * Roots are marked with `parent = 0`, NOT NULL (verified: 6 rows at parent=0, 0 at
 * parent IS NULL), and there is no category with id 0. So `parent IS NOT NULL` alone
 * let the sentinel 0 into the chain, and every root-level material carried a phantom
 * "ancestor 0". Harmless while no pivot row points at category 0 — but a single
 * `mcategory_id = 0` row in any of the three pivots would then unlock every
 * root-level material for everyone who owns that container. `parent > 0` stops the
 * walk at the real root. No behavior change today; this closes the leak by
 * construction rather than relying on the pivots staying clean.
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
 * Entitlement scope = the ONE container the client navigated FROM.
 *
 * A material category is attachable to many containers at once, so "does this customer
 * own anything that grants it" is the wrong question when the user is browsing inside
 * one specific product: owning Course 1 would otherwise mark a material
 * `isPurchased: true` while the student is looking at it inside **unpurchased** Live
 * Course 3 — a paid product leaking into an unpaid one. Same defect, and the same fix,
 * as the shared-live-session entry-point work (2026-07-30, `?liveCourseId`).
 *
 * All three container kinds are scopeable because all three can attach the same
 * category — scoping only live courses would leave the identical leak between two
 * courses, or between a course and a package.
 *
 * `null` (no param) keeps the unscoped global-OR reading, which is what the standalone
 * Study-Material tab wants — it is not entered from any container.
 */
export type MaterialEntitlementScope =
  | { kind: "course"; id: number }
  | { kind: "package"; id: number }
  | { kind: "liveCourse"; id: number }
  | null;

/**
 * Set of owned (purchased) material ids for a batch (free ones excluded).
 *
 * When `scope` names a container, ONLY that container can grant access — the other two
 * pivots are not consulted at all, and the scoped kind's pivot is narrowed to that one
 * id. Scoping can therefore only ever withhold access, never widen it.
 */
export const getPurchasedMaterialIds = async (
  customerId: number | null,
  materials: MatLite[],
  scope: MaterialEntitlementScope = null
): Promise<Set<number>> => {
  const owned = new Set<number>();
  if (!customerId) return owned;
  // Study materials are ALWAYS paid (hard rule) — every material is entitlement-
  // checked, including any legacy row whose stored isPaid is false, so a historical
  // free flag can never leak the PDF without a subscription.
  const paid = materials;
  if (!paid.length) return owned;

  const leafIds = [...new Set(paid.map((m) => m.materialCategoryId).filter((n) => n != null))];
  const { universe, byLeaf } = await categoryUniverse(leafIds);
  const universeIds = [...universe];
  if (!universeIds.length) return owned;

  // Containers (course/package/live-course) whose pivot attaches a universe
  // category. All three read the same way — live course got its pivot on
  // 2026-07-31 (ws_material_category_live_course); before that its attachments
  // were JSON-only and live-course buyers saw isPurchased:false on everything.
  //
  // Scoped to container X, the other two kinds are deliberately NOT queried and X's
  // own pivot is narrowed to that single id: inside product N the only question is
  // whether the customer owns N. Unscoped, all three are read as before.
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
    // Live-course entitlement predicate is the one used everywhere else
    // (client-search, exam-countdown, lecture-progress): active + verified, and
    // a null endAt means lifetime.
    liveCourseIds.length ? prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: liveCourseIds }, status: true, paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gte: now } }] }, select: { liveCourseId: true } }) : [],
  ]);
  const ownedCourseSet = new Set(ownedCourses.map((r) => r.courseId!));
  const ownedPackageSet = new Set(ownedPackages.map((r) => r.packageId!));
  const ownedLiveCourseSet = new Set(ownedLiveCourses.map((r) => r.liveCourseId));

  // Categories unlocked via an owned container.
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
 * DB-agnostic shaping. The raw `file` / `directLink` URLs are NEVER emitted —
 * they are replaced by an opaque `mediaToken` the client exchanges at
 * /client/media/resolve (null for unpurchased paid materials, same as the old
 * gated-empty behavior). `isDirectLink` tells the client whether the resolved
 * URL is an external link (open in browser) vs an uploaded PDF (in-app viewer).
 */
export const shapeMaterial = (m: any, ownedIds: Set<number>, customerId: number | null = null) => {
  const isPaid = true; // hard rule: study materials are always paid (ignores stored isPaid)
  const isPurchased = ownedIds.has(m.id);
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
    // Encrypted media contract — raw URLs withheld; resolve via mediaToken.
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

/** Normalize an already-parsed scope; anything falsy ⇒ unscoped global OR. */
const toScope = (scope?: MaterialEntitlementScope): MaterialEntitlementScope =>
  scope && Number.isInteger(scope.id) && scope.id > 0 ? scope : null;

// ── leaf-count + newly-added (subtree) ──────────────────────────────────────
const subtreeCategoryIds = async (rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${rootId} UNION SELECT c.id FROM ws_material_category c JOIN tree t ON c.parent = t.id) SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

export const leafCount = async (categoryId: number): Promise<number> => {
  const ids = await subtreeCategoryIds(categoryId);
  return prisma.material.count({ where: { materialCategoryId: { in: ids }, status: true } });
};

export const hasNewlyAdded = async (categoryId: number, days = 10): Promise<boolean> => {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const ids = await subtreeCategoryIds(categoryId);
  const n = await prisma.material.count({ where: { materialCategoryId: { in: ids }, status: true, created_at: { gt: cutoff } } });
  return n > 0;
};

// ── handlers ────────────────────────────────────────────────────────────────
export const findCategory = (id: number) =>
  prisma.materialCategory.findFirst({ where: { id, status: true }, select: { id: true, name: true, image: true, parent: true } });

export const getCategoryContents = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip?: number; take?: number; search?: string | null; scope?: MaterialEntitlementScope } = {}
) => {
  const current = await findCategory(categoryId);
  if (!current) return null;

  const children = await prisma.materialCategory.findMany({ where: { parent: categoryId, status: true }, select: { id: true, name: true, image: true, order_by: true }, orderBy: [{ order_by: "asc" }, { created_at: "asc" }] });
  const subjects = await Promise.all(children.map(async (c) => {
    const [grandChildren, count, isNewlyAdded] = await Promise.all([
      prisma.materialCategory.count({ where: { parent: c.id, status: true } }),
      leafCount(c.id),
      hasNewlyAdded(c.id),
    ]);
    return { _id: String(c.id), title: c.name, image: c.image, order: c.order_by, havingChildDirectory: grandChildren > 0, count, isNewlyAdded };
  }));

  // Leaf materials at this node — the genuine collection we paginate. Child
  // folders (`subjects`) + breadcrumbs are node metadata and stay intact.
  const matsWhere: any = { materialCategoryId: categoryId, status: true };
  const matsSearch = buildPrismaSearch(opts.search, ["name"]);
  if (matsSearch) matsWhere.AND = matsSearch.AND;
  const [matsRaw, materialsTotal] = await Promise.all([
    prisma.material.findMany({ where: matsWhere, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take, select: MAT_SELECT }),
    prisma.material.count({ where: matsWhere }),
  ]);
  const ownedIds = await getPurchasedMaterialIds(customerId, matsRaw.map(toLite), toScope(opts.scope));
  const materials = matsRaw.map((m) => shapeMaterial(m, ownedIds, customerId));

  // breadcrumbs: ancestor chain (root → current) via the parent walk.
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

/**
 * Paginated leaf materials directly under a category — SQL equivalent of the
 * Mongo `listMaterialsByCategory` (GET /client/material-categories/:id/materials).
 * Returns the category DTO, the shaped+entitlement-gated material list, and the
 * total for pagination. `type` mirrors the Mongo `?type=free|paid` filter.
 */
export const listMaterialsByCategoryPaged = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip: number; take: number; search?: string | null; type?: "free" | "paid" | null; scope?: MaterialEntitlementScope }
) => {
  const category = await findCategory(categoryId);
  if (!category) return null;

  const where: any = { materialCategoryId: categoryId, status: true };
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
 * `liveCourseId` matters here as much as on the list: this is the mediaToken-refresh
 * path, so an unscoped detail call would hand back a token for a material the student
 * is opening from a live course they never bought.
 */
export const getMaterialDetail = async (materialId: number, customerId: number | null, scope?: MaterialEntitlementScope) => {
  const m = await prisma.material.findFirst({ where: { id: materialId, status: true }, select: { ...MAT_SELECT, MaterialCategory: { select: { id: true, name: true } } } });
  if (!m) return null;
  const ownedIds = await getPurchasedMaterialIds(customerId, [toLite(m)], toScope(scope));
  const shaped = shapeMaterial(m, ownedIds, customerId);
  (shaped as any).materialCategoryId = m.MaterialCategory ? { _id: String(m.MaterialCategory.id), title: m.MaterialCategory.name } : (m.materialCategoryId != null ? String(m.materialCategoryId) : null);
  return shaped;
};

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
  const where: any = { status: true, created_at: { gt: cutoff } };
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
