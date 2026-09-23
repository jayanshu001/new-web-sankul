/**
 * Keep `ws_video_category_package_relation` (PackageVideoCategoryRelation) in sync
 * with the video-category DAG.
 *
 * A package "contains" every `ws_video_category_relation` edge in the DOWNWARD
 * closure of its active specific-subjects (`ws_package_specific_subject`). The SQL
 * package-save path only writes the subjects, and the DAG (`ws_video_category_relation`)
 * is edited independently by the video-category admin — so this recomputes the flat
 * relation rows on BOTH triggers:
 *   - a package's subjects change  → `resyncPackageRelations([packageId])`
 *   - the DAG gains/loses an edge  → `resyncAllPackageRelations()` (rebuild all,
 *     since a moved/added edge can change any package whose subtree includes it).
 *
 * Note: the SQL client tree/scope/media path already works off the subjects + the DAG
 * directly (see catalog-category-tree), so this table is effectively a denormalized
 * cache — kept current here for consumers that read it directly.
 */
import { prisma } from "../../config/prisma";
import logger from "../../utils/logger";

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Compute, for each requested package, the ids of every DAG edge reachable downward
// (parent → child) from any of its active specific-subjects. Loads the whole DAG once.
const computeEdgeIdsByPackage = async (packageIds: number[]): Promise<Map<number, number[]>> => {
  const edges = await prisma.videoCategoryRelation.findMany({ select: { id: true, parent: true, child: true } });
  const byParent = new Map<number, { id: number; child: number }[]>();
  for (const e of edges) {
    if (e.parent == null || e.parent <= 0) continue;
    const a = byParent.get(e.parent);
    if (a) a.push({ id: e.id, child: e.child });
    else byParent.set(e.parent, [{ id: e.id, child: e.child }]);
  }

  const subs = await prisma.packageSpecificSubject.findMany({
    where: { packageId: { in: packageIds }, status: true },
    select: { packageId: true, subjectId: true },
  });
  const subjectsByPkg = new Map<number, number[]>();
  for (const s of subs) {
    if (s.packageId == null || s.subjectId == null || s.subjectId <= 0) continue;
    const a = subjectsByPkg.get(s.packageId);
    if (a) a.push(s.subjectId);
    else subjectsByPkg.set(s.packageId, [s.subjectId]);
  }

  const closure = (roots: number[]): number[] => {
    const seenNodes = new Set<number>(roots);
    const edgeIds = new Set<number>();
    const stack = [...roots];
    let guard = 0;
    while (stack.length && guard++ < 1_000_000) {
      const n = stack.pop()!;
      for (const e of byParent.get(n) ?? []) {
        edgeIds.add(e.id);
        if (!seenNodes.has(e.child)) {
          seenNodes.add(e.child);
          stack.push(e.child);
        }
      }
    }
    return [...edgeIds];
  };

  const out = new Map<number, number[]>();
  for (const pkgId of packageIds) out.set(pkgId, closure(subjectsByPkg.get(pkgId) ?? []));
  return out;
};

/**
 * Rebuild the relation rows for the given packages: replace each package's rows with
 * the current DAG closure of its specific-subjects. One transaction (delete the target
 * packages' rows, then chunked insert). No-op for an empty id list.
 */
export const resyncPackageRelations = async (packageIds: number[]): Promise<void> => {
  const ids = [...new Set(packageIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;

  // Best-effort denormalized cache: never let a sync failure break the package/category
  // admin write that triggered it (the primary read path doesn't depend on this table).
  try {
    const edgeIdsByPkg = await computeEdgeIdsByPackage(ids);
    const rows: { packageId: number; videoCategoryRelationId: number; status: boolean }[] = [];
    for (const pkgId of ids) {
      for (const relId of edgeIdsByPkg.get(pkgId) ?? []) {
        rows.push({ packageId: pkgId, videoCategoryRelationId: relId, status: true });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.packageVideoCategoryRelation.deleteMany({ where: { packageId: { in: ids } } });
      for (const c of chunk(rows, 5000)) {
        await tx.packageVideoCategoryRelation.createMany({ data: c });
      }
    });
  } catch (e: any) {
    logger.error("resyncPackageRelations failed", { packageIds: ids, error: e?.message });
  }
};

/** Every package that has at least one active specific-subject. */
const packageIdsWithSubjects = async (): Promise<number[]> => {
  const rows = await prisma.packageSpecificSubject.findMany({
    where: { status: true, packageId: { not: null } },
    select: { packageId: true },
    distinct: ["packageId"],
  });
  return rows.map((r) => r.packageId!).filter((n) => n > 0);
};

/**
 * Rebuild the relation rows for ALL packages. Used after a DAG edge mutation, where a
 * single added/moved/removed edge can change any package whose subtree includes it.
 * Best-effort (never throws) — safe to await from an admin write path.
 */
export const resyncAllPackageRelations = async (): Promise<void> => {
  await resyncPackageRelations(await packageIdsWithSubjects());
};

/**
 * ATOMIC full-table rebuild for the backfill script: clears EVERY row (incl. packages
 * that no longer have subjects) and rebuilds, all in ONE transaction — so a mid-run
 * failure rolls back and leaves the existing rows intact. Throws on failure (fail-loud),
 * unlike the best-effort runtime syncs. Returns the new row count.
 */
export const rebuildAllPackageRelations = async (): Promise<number> => {
  const ids = await packageIdsWithSubjects();
  const edgeIdsByPkg = ids.length ? await computeEdgeIdsByPackage(ids) : new Map<number, number[]>();
  const rows: { packageId: number; videoCategoryRelationId: number; status: boolean }[] = [];
  for (const pkgId of ids) {
    for (const relId of edgeIdsByPkg.get(pkgId) ?? []) {
      rows.push({ packageId: pkgId, videoCategoryRelationId: relId, status: true });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.packageVideoCategoryRelation.deleteMany({});
    for (const c of chunk(rows, 5000)) await tx.packageVideoCategoryRelation.createMany({ data: c });
  });
  return rows.length;
};
