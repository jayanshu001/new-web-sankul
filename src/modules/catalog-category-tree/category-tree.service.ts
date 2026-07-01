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

/**
 * All descendant category ids of the given roots (INCLUSIVE of the roots),
 * walking DOWN `ws_video_category_relation` (parent → child). Mirrors
 * `collectCategoryTreeIds` BFS semantics; deduped; cycle-safe via depth cap.
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
       SELECT r.child, t.depth + 1
         FROM ws_video_category_relation r
         JOIN tree t ON r.parent = t.id
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
 * `ws_video_category_relation` (child → parent). Mirrors the bounded up-walk in
 * `resolveVideoCourse`/`resolveVideoScope`'s ancestorChain.
 */
export const ancestorsOf = async (leafIds: number[]): Promise<number[]> => {
  const leaves = [...new Set(leafIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!leaves.length) return [];
  const seed = leaves.map((id) => `SELECT ${id} AS id, 0 AS depth`).join(" UNION ALL ");
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE chain (id, depth) AS (
       ${seed}
       UNION
       SELECT r.parent, c.depth + 1
         FROM ws_video_category_relation r
         JOIN chain c ON r.child = c.id
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
      prisma.course.findFirst({ where: { id: scopeId, status: true }, select: { videoCategoryId: true } }),
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
      prisma.liveCourse.findFirst({ where: { id: scopeId, status: true }, select: { videoCategoryId: true } }),
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

  // ── course ──
  const [catWithCourse, owningCourse] = await Promise.all([
    prisma.videoCategory.findFirst({ where: { id: { in: ancestors }, course: { some: {} } }, select: { course: { select: { id: true }, take: 1 } } }),
    prisma.course.findFirst({ where: { videoCategoryId: { in: ancestors }, status: true }, select: { id: true } }),
  ]);
  if (catWithCourse?.course?.[0]?.id) return { kind: "course", id: String(catWithCourse.course[0].id) };
  if (owningCourse?.id) return { kind: "course", id: String(owningCourse.id) };

  // ── live course ── (downward pointer only; no SQL live_course_id tag column)
  const owningLive = await prisma.liveCourse.findFirst({ where: { videoCategoryId: { in: ancestors }, status: true }, select: { id: true } });
  if (owningLive?.id) return { kind: "liveCourse", id: String(owningLive.id) };

  // ── package ──
  const directPkg = await prisma.packageSpecificSubject.findFirst({
    where: { subjectId: { in: ancestors }, status: true, Package: { active: true } },
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
 * Resolve the owning courseId for a recorded video's leaf category (SQL mirror
 * of resolveVideoCourseId). Leaf's course → ancestor's course → Course pointing
 * down at leaf/ancestor.
 */
export const resolveVideoCourseId = async (videoCategoryId: number | null | undefined): Promise<number | null> => {
  if (!videoCategoryId) return null;
  // 1. leaf category's own course
  const leafCourse = await prisma.course.findFirst({ where: { videoCategoryId, status: true }, select: { id: true } });
  if (leafCourse?.id) return leafCourse.id;
  // 2. any ancestor that a course points down at
  const ancestors = await ancestorsOf([videoCategoryId]);
  const owning = await prisma.course.findFirst({ where: { videoCategoryId: { in: ancestors }, status: true }, select: { id: true } });
  return owning?.id ?? null;
};
