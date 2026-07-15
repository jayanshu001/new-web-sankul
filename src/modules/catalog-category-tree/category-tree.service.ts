/**
 * VideoCategory DAG resolver — MySQL (Prisma) branch. The SQL equivalent of the
 * Mongo `collectCategoryTreeIds` (down-walk) + `scopeReachableCategories` +
 * `resolveVideoScope`/`resolveVideoCourse` (up-walk), built on recursive CTEs
 * over `ws_video_category_relation` (parent,child edges — already populated).
 *
 * Gated behind `isMysqlModule("catalog-category-tree")`. All ids are SQL ints.
 *
 * Why CTEs: the edge table already holds the full DAG (2456 rows staging / fully
 * populated in prod), so no closure table / backfill is needed. Each walk is one
 * round-trip with a DEPTH CAP (matches the Mongo bounded BFS + guards cycles).
 */
import { prisma } from "../../config/prisma";

export const CATEGORY_TREE_MODULE = "catalog-category-tree";
export const isCategoryTreeMysql = (): boolean => true;

const MAX_DEPTH = 20; // generous cap; real trees are <6 deep. Guards cycles.

// Both walkers traverse the UNION of two hierarchy stores, not the pivot alone:
//   (a) ws_video_category_relation — the many-to-many DAG (source of truth), and
//   (b) ws_video_category.parent    — the legacy single-parent self-FK.
// Admin historically wrote subcategory links via the self-FK and only later
// mirrored them into the pivot (see the 2026-07-13 backfill). Until every deploy
// is fully backfilled, a subcategory nested >1 level deep can have its pivot edge
// missing — which silently truncated the ancestor chain, so resolveVideoScope
// returned null and paid videos got a null mediaToken. Following the self-FK too
// keeps the walk correct regardless of pivot completeness. The self-FK arm only
// ADDS edges (never contradicts the pivot); dedup + depth cap keep it cycle-safe.
const CHILD_TO_PARENT_EDGES =
  `SELECT child AS node, parent AS parent_id FROM ws_video_category_relation WHERE parent > 0
   UNION
   SELECT id AS node, parent AS parent_id FROM ws_video_category WHERE parent > 0`;
const PARENT_TO_CHILD_EDGES =
  `SELECT parent AS node, child AS child_id FROM ws_video_category_relation WHERE child > 0
   UNION
   SELECT parent AS node, id AS child_id FROM ws_video_category WHERE parent > 0`;

/**
 * All descendant category ids of the given roots (INCLUSIVE of the roots),
 * walking DOWN (parent → child) over both the pivot DAG and the self-FK column.
 * Mirrors `collectCategoryTreeIds` BFS semantics; deduped; cycle-safe via depth cap.
 */
export const descendantsOf = async (rootIds: number[]): Promise<number[]> => {
  const roots = [...new Set(rootIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!roots.length) return [];
  // Seed directly from the root ids (a UNION of literals) rather than gating on
  // ws_video_category membership — the relation table is the source of truth for
  // edges, and some referenced category rows may be absent in staging.
  const seed = roots.map((id) => `SELECT ${id} AS id, 0 AS depth`).join(" UNION ALL ");
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id, depth) AS (
       ${seed}
       UNION
       SELECT e.child_id, t.depth + 1
         FROM tree t
         JOIN (${PARENT_TO_CHILD_EDGES}) e ON e.node = t.id
        WHERE t.depth < ${MAX_DEPTH}
     )
     SELECT DISTINCT id FROM tree`
  );
  const ids = new Set<number>(roots);
  for (const r of rows) ids.add(Number(r.id));
  return [...ids];
};

/**
 * All ancestor category ids of the given leaves (INCLUSIVE), walking UP
 * (child → parent) over both the pivot DAG and the self-FK column. Mirrors the
 * bounded up-walk in `resolveVideoCourse`/`resolveVideoScope`'s ancestorChain.
 */
export const ancestorsOf = async (leafIds: number[]): Promise<number[]> => {
  const leaves = [...new Set(leafIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!leaves.length) return [];
  const seed = leaves.map((id) => `SELECT ${id} AS id, 0 AS depth`).join(" UNION ALL ");
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE chain (id, depth) AS (
       ${seed}
       UNION
       SELECT e.parent_id, c.depth + 1
         FROM chain c
         JOIN (${CHILD_TO_PARENT_EDGES}) e ON e.node = c.id
        WHERE c.depth < ${MAX_DEPTH}
     )
     SELECT DISTINCT id FROM chain`
  );
  const ids = new Set<number>(leaves);
  for (const r of rows) ids.add(Number(r.id));
  return [...ids];
};

/**
 * Resolve the FULL set of reachable video-category ids for a product (course /
 * liveCourse / package). SQL mirror of `resolveScopedReachableVideoCategoryIds`:
 * gather the linked ROOTS for the product kind, then expand each downward.
 */
export const reachableCategoryIds = async (
  kind: "course" | "liveCourse" | "package",
  scopeId: number
): Promise<Set<number>> => {
  const rootIds = new Set<number>();

  if (kind === "course") {
    const [course, tagged] = await Promise.all([
      // No status filter on the container: this resolves TOPOLOGY (which categories a
      // course owns) for OWNED-content access. A deactivated course must still resolve
      // for its existing subscribers; non-owners are gated by the subscription check
      // downstream. Browse/discovery uses the separate catalog-course repo (keeps status).
      prisma.course.findFirst({ where: { id: scopeId }, select: { videoCategoryId: true } }),
      prisma.videoCategory.findMany({ where: { course: { some: { id: scopeId } } }, select: { id: true } }),
    ]);
    if (course?.videoCategoryId) rootIds.add(course.videoCategoryId);
    for (const c of tagged) rootIds.add(c.id);
  } else if (kind === "liveCourse") {
    // Two linkage forms, mirroring the `course` branch: (a) the course's downward
    // root pointer (ws_live_course.video_category_id), and (b) categories tagged
    // directly with this course via ws_video_category.live_course_id — which IS
    // how live-course folders are keyed (the recordings reader + admin folder ops
    // both resolve by this column). Live courses generally have no root set, so
    // omitting (b) made every live-course video unreachable (false "not part of").
    const [lc, tagged] = await Promise.all([
      // No container status filter — topology for owned access (see course branch).
      prisma.liveCourse.findFirst({ where: { id: scopeId }, select: { videoCategoryId: true } }),
      prisma.videoCategory.findMany({ where: { liveCourseId: scopeId }, select: { id: true } }),
    ]);
    if (lc?.videoCategoryId) rootIds.add(lc.videoCategoryId);
    for (const c of tagged) rootIds.add(c.id);
  } else {
    // package: (a) PackageSpecificSubject.subjectId roots, (b) the relation pairs
    // (both parent + child of each linked VideoCategoryRelation) count as roots.
    const [subjects, pkgRels] = await Promise.all([
      prisma.packageSpecificSubject.findMany({ where: { packageId: scopeId, status: true }, select: { subjectId: true } }),
      prisma.packageVideoCategoryRelation.findMany({ where: { packageId: scopeId, status: true }, select: { videoCategoryRelationId: true } }),
    ]);
    for (const s of subjects) if (s.subjectId) rootIds.add(s.subjectId);
    if (pkgRels.length) {
      const relIds = pkgRels.map((r) => r.videoCategoryRelationId);
      const rels = await prisma.videoCategoryRelation.findMany({ where: { id: { in: relIds } }, select: { parent: true, child: true } });
      for (const r of rels) { if (r.parent) rootIds.add(r.parent); if (r.child) rootIds.add(r.child); }
    }
  }

  if (rootIds.size === 0) return new Set<number>();
  const all = await descendantsOf([...rootIds]);
  return new Set<number>(all);
};

export type VideoScope = { kind: "course" | "liveCourse" | "package"; id: string };

/**
 * Resolve the owning container (course / liveCourse / package) for a recorded
 * video by its leaf category. SQL mirror of `resolveVideoScope`: walk leaf +
 * ancestors, try each container type in priority order (course → live → package).
 */
export const resolveVideoScope = async (videoCategoryId: number | null | undefined): Promise<VideoScope | null> => {
  if (!videoCategoryId) return null;
  const ancestors = await ancestorsOf([videoCategoryId]);

  // Ownership/topology resolver → NO container status filter (course.status /
  // liveCourse.status / Package.active), so a DEACTIVATED container still resolves as the
  // owner for its existing subscribers. Non-owners are gated by the subscription check in
  // the caller. Row-level link status (subject/relation) is kept. See reachableCategoryIds.
  // ── course ──
  const [catWithCourse, owningCourse] = await Promise.all([
    prisma.videoCategory.findFirst({ where: { id: { in: ancestors }, course: { some: {} } }, select: { course: { select: { id: true }, take: 1 } } }),
    prisma.course.findFirst({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } }),
  ]);
  if (catWithCourse?.course?.[0]?.id) return { kind: "course", id: String(catWithCourse.course[0].id) };
  if (owningCourse?.id) return { kind: "course", id: String(owningCourse.id) };

  // ── live course ── (downward pointer only; no SQL live_course_id tag column)
  const owningLive = await prisma.liveCourse.findFirst({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } });
  if (owningLive?.id) return { kind: "liveCourse", id: String(owningLive.id) };

  // ── package ── (keep the subject-link row status; drop the Package.active container gate)
  const directPkg = await prisma.packageSpecificSubject.findFirst({
    where: { subjectId: { in: ancestors }, status: true },
    select: { packageId: true },
  });
  if (directPkg?.packageId) return { kind: "package", id: String(directPkg.packageId) };

  const relRows = await prisma.videoCategoryRelation.findMany({
    where: { OR: [{ child: { in: ancestors } }, { parent: { in: ancestors } }] },
    select: { id: true },
  });
  if (relRows.length) {
    const pkgRel = await prisma.packageVideoCategoryRelation.findFirst({
      where: { videoCategoryRelationId: { in: relRows.map((r) => r.id) }, status: true },
      select: { packageId: true },
    });
    if (pkgRel?.packageId) return { kind: "package", id: String(pkgRel.packageId) };
  }
  return null;
};

/**
 * ALL owning containers for a video's leaf category — unlike resolveVideoScope (which
 * returns only the FIRST match), this returns every course / live-course / package the
 * category belongs to. A video's category can sit under multiple packages, so
 * entitlement must consider all of them (a buyer of ANY owning package is entitled).
 * Ordered course → liveCourse → package (same priority as the single resolver).
 */
export const resolveVideoScopes = async (videoCategoryId: number | null | undefined): Promise<VideoScope[]> => {
  if (!videoCategoryId) return [];
  const ancestors = await ancestorsOf([videoCategoryId]);
  if (!ancestors.length) return [];

  // Ownership/topology → NO container status filter (owners of a deactivated container
  // keep access; non-owners gated by the subscription check in entitledScopeFor).
  const [catCourses, owningCourses, owningLives, directPkgs, relRows] = await Promise.all([
    prisma.videoCategory.findMany({ where: { id: { in: ancestors }, course: { some: {} } }, select: { course: { select: { id: true } } } }),
    prisma.course.findMany({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } }),
    prisma.liveCourse.findMany({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } }),
    prisma.packageSpecificSubject.findMany({ where: { subjectId: { in: ancestors }, status: true }, select: { packageId: true } }),
    prisma.videoCategoryRelation.findMany({ where: { OR: [{ child: { in: ancestors } }, { parent: { in: ancestors } }] }, select: { id: true } }),
  ]);

  const courseIds = new Set<number>();
  for (const c of catCourses) for (const cc of c.course) if (cc.id) courseIds.add(cc.id);
  for (const c of owningCourses) courseIds.add(c.id);
  const liveIds = new Set<number>(owningLives.map((l) => l.id));
  const pkgIds = new Set<number>();
  for (const p of directPkgs) if (p.packageId) pkgIds.add(p.packageId);
  if (relRows.length) {
    const relPkgs = await prisma.packageVideoCategoryRelation.findMany({
      where: { videoCategoryRelationId: { in: relRows.map((r) => r.id) }, status: true },
      select: { packageId: true },
    });
    for (const p of relPkgs) if (p.packageId) pkgIds.add(p.packageId);
  }

  const scopes: VideoScope[] = [];
  for (const id of courseIds) scopes.push({ kind: "course", id: String(id) });
  for (const id of liveIds) scopes.push({ kind: "liveCourse", id: String(id) });
  for (const id of pkgIds) scopes.push({ kind: "package", id: String(id) });
  return scopes;
};

/**
 * Resolve the owning courseId for a recorded video's leaf category (SQL mirror
 * of resolveVideoCourseId). Leaf's course → ancestor's course → Course pointing
 * down at leaf/ancestor.
 */
export const resolveVideoCourseId = async (videoCategoryId: number | null | undefined): Promise<number | null> => {
  if (!videoCategoryId) return null;
  // Topology/ownership resolver → no course.status filter (owned access survives
  // deactivation; callers gate on the subscription).
  // 1. leaf category's own course
  const leafCourse = await prisma.course.findFirst({ where: { videoCategoryId }, select: { id: true } });
  if (leafCourse?.id) return leafCourse.id;
  // 2. any ancestor that a course points down at
  const ancestors = await ancestorsOf([videoCategoryId]);
  const owning = await prisma.course.findFirst({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } });
  return owning?.id ?? null;
};
