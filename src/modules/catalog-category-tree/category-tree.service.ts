// Video category tree: DAG walks and video-to-product scope resolution.
import { prisma } from "../../config/prisma";

const MAX_DEPTH = 20; // generous cap; real trees are <6 deep. Guards cycles.

// Both walkers traverse the union of ws_video_category_relation (the DAG, source of
// truth) and the legacy ws_video_category.parent self-FK. A subcategory can be
// missing its pivot edge on a deploy that was not fully backfilled, which truncates
// the ancestor chain (resolveVideoScope returns null and paid videos get a null
// mediaToken). The self-FK arm only adds edges; dedup and the depth cap keep it cycle-safe.
const CHILD_TO_PARENT_EDGES =
  `SELECT child AS node, parent AS parent_id FROM ws_video_category_relation WHERE parent > 0
   UNION
   SELECT id AS node, parent AS parent_id FROM ws_video_category WHERE parent > 0`;
const PARENT_TO_CHILD_EDGES =
  `SELECT parent AS node, child AS child_id FROM ws_video_category_relation WHERE child > 0
   UNION
   SELECT parent AS node, id AS child_id FROM ws_video_category WHERE parent > 0`;

/** Descendant ids of the given roots (inclusive), walking down over both the pivot DAG and the self-FK. */
export const descendantsOf = async (rootIds: number[]): Promise<number[]> => {
  const roots = [...new Set(rootIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!roots.length) return [];
  // Seed from the literal root ids rather than ws_video_category membership: some
  // referenced category rows may be absent.
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
 * Same as calling `descendantsOf([root])` per root, but resolves every root in one
 * recursive CTE that carries the seed `root` through, then buckets by root.
 */
export const descendantsByRoot = async (
  rootIds: number[]
): Promise<Map<number, number[]>> => {
  const roots = [...new Set(rootIds.filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map<number, number[]>();
  if (!roots.length) return out;

  const seed = roots
    .map((id) => `SELECT ${id} AS root, ${id} AS id, 0 AS depth`)
    .join(" UNION ALL ");
  const rows = await prisma.$queryRawUnsafe<{ root: number; id: number }[]>(
    `WITH RECURSIVE tree (root, id, depth) AS (
       ${seed}
       UNION
       SELECT t.root, e.child_id, t.depth + 1
         FROM tree t
         JOIN (${PARENT_TO_CHILD_EDGES}) e ON e.node = t.id
        WHERE t.depth < ${MAX_DEPTH}
     )
     SELECT DISTINCT root, id FROM tree`
  );

  const acc = new Map<number, Set<number>>(roots.map((r) => [r, new Set([r])]));
  for (const r of rows) {
    const bucket = acc.get(Number(r.root));
    if (bucket) bucket.add(Number(r.id));
  }
  for (const [root, ids] of acc) out.set(root, [...ids]);
  return out;
};

/** Ancestor ids of the given leaves (inclusive), walking up over both the pivot DAG and the self-FK. */
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

/** Every video-category id reachable from a product: its linked roots expanded downward. */
export const reachableCategoryIds = async (
  kind: "course" | "liveCourse" | "package",
  scopeId: number
): Promise<Set<number>> => {
  const rootIds = new Set<number>();

  if (kind === "course") {
    const [course, tagged] = await Promise.all([
      // No status filter: this resolves topology for owned-content access, so a
      // deactivated course still resolves for its subscribers (non-owners are gated by
      // the subscription check). Browse uses the catalog-course repo, which keeps status.
      prisma.course.findFirst({ where: { id: scopeId }, select: { videoCategoryId: true } }),
      prisma.videoCategory.findMany({ where: { course: { some: { id: scopeId } } }, select: { id: true } }),
    ]);
    if (course?.videoCategoryId) rootIds.add(course.videoCategoryId);
    for (const c of tagged) rootIds.add(c.id);
  } else if (kind === "liveCourse") {
    // Two linkages, as for courses: the root pointer ws_live_course.video_category_id
    // and categories tagged via ws_video_category.live_course_id. Live-course folders
    // are keyed by the latter and usually have no root set, so it is required.
    const [lc, tagged] = await Promise.all([
      // No container status filter (see the course branch).
      prisma.liveCourse.findFirst({ where: { id: scopeId }, select: { videoCategoryId: true } }),
      prisma.videoCategory.findMany({ where: { liveCourseId: scopeId }, select: { id: true } }),
    ]);
    if (lc?.videoCategoryId) rootIds.add(lc.videoCategoryId);
    for (const c of tagged) rootIds.add(c.id);
  } else {
    // Roots: PackageSpecificSubject.subjectId plus both ends of each linked VideoCategoryRelation.
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

/** First owning container of a video's leaf category, trying course → live → package over the leaf and its ancestors. */
export const resolveVideoScope = async (videoCategoryId: number | null | undefined): Promise<VideoScope | null> => {
  if (!videoCategoryId) return null;
  const ancestors = await ancestorsOf([videoCategoryId]);

  // No container status filter (course.status / liveCourse.status / Package.active):
  // a deactivated container still resolves as owner for its existing subscribers.
  // Non-owners are gated by the caller's subscription check; row-level link status is kept.
  const [catWithCourse, owningCourse] = await Promise.all([
    prisma.videoCategory.findFirst({ where: { id: { in: ancestors }, course: { some: {} } }, select: { course: { select: { id: true }, take: 1 } } }),
    prisma.course.findFirst({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } }),
  ]);
  if (catWithCourse?.course?.[0]?.id) return { kind: "course", id: String(catWithCourse.course[0].id) };
  if (owningCourse?.id) return { kind: "course", id: String(owningCourse.id) };

  const owningLive = await prisma.liveCourse.findFirst({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } });
  if (owningLive?.id) return { kind: "liveCourse", id: String(owningLive.id) };

  // Keep the subject-link row status; no Package.active container gate.
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
 * Every owning course / live course / package (ordered course → liveCourse →
 * package). A category can sit under multiple packages, and a buyer of any of
 * them is entitled.
 */
export const resolveVideoScopes = async (videoCategoryId: number | null | undefined): Promise<VideoScope[]> => {
  if (!videoCategoryId) return [];
  const ancestors = await ancestorsOf([videoCategoryId]);
  if (!ancestors.length) return [];

  // No container status filter: owners of a deactivated container keep access;
  // non-owners are gated by the subscription check in entitledScopeFor.
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

/** The leaf's own course first, then any course pointing down at an ancestor. */
export const resolveVideoCourseId = async (videoCategoryId: number | null | undefined): Promise<number | null> => {
  if (!videoCategoryId) return null;
  // No course.status filter: owned access survives deactivation; callers gate on the subscription.
  const leafCourse = await prisma.course.findFirst({ where: { videoCategoryId }, select: { id: true } });
  if (leafCourse?.id) return leafCourse.id;
  const ancestors = await ancestorsOf([videoCategoryId]);
  const owning = await prisma.course.findFirst({ where: { videoCategoryId: { in: ancestors } }, select: { id: true } });
  return owning?.id ?? null;
};
