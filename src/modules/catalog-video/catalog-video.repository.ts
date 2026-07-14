import { prisma } from "../../config/prisma";
import { childIdsOf } from "../../utils/videoCategoryRelation";

/**
 * Prisma persistence for the catalog · video MySQL branch (flag OFF).
 *
 * Scope: `ws_video` + `ws_video_category`. The M:N relation tables are deferred
 * (D2) — see catalog-video.types.ts. Reads mirror the Mongo Video queries
 * (`{status:true}` gating, `{videoCategoryId, status, order}` index order).
 */
export const catalogVideoRepository = {
  // ── video (ws_video) ─────────────────────────────────────────────────────
  /** Single active video by id. */
  findVideoById: (id: number) =>
    prisma.video.findFirst({ where: { id, status: true } }),

  /** Active videos in a category, ordered by `order_by` then id (Mongo parity). */
  listActiveVideosByCategory: (videoCategoryId: number) =>
    prisma.video.findMany({
      where: { status: true, videoCategoryId },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),

  /** Count active videos in a category (catalog group counts). */
  countActiveVideosByCategory: (videoCategoryId: number) =>
    prisma.video.count({ where: { status: true, videoCategoryId } }),

  // ── video category (ws_video_category) ───────────────────────────────────
  /** Single active category by id. */
  findCategoryById: (id: number) =>
    prisma.videoCategory.findFirst({ where: { id, status: true } }),

  /** Single category by id, NO status gate (parent of a children-nav lookup). */
  findCategoryByIdAny: (id: number) =>
    prisma.videoCategory.findFirst({ where: { id } }),

  /** Active categories, ordered by `order_by` then title. */
  listActiveCategories: () =>
    prisma.videoCategory.findMany({
      where: { status: true },
      orderBy: [{ order_by: "asc" }, { title: "asc" }],
    }),

  /**
   * Active CHILD categories of a parent (children-nav drill-down). Children come
   * from ws_video_category_relation (the DAG edge table); the returned rows are then
   * filtered to active + optional title search and paginated. Ordered by order_by.
   */
  listActiveChildren: async (parentId: number, opts?: { search?: string; skip?: number; take?: number }) => {
    const childIds = await childIdsOf(parentId);
    if (!childIds.length) return [];
    return prisma.videoCategory.findMany({
      where: catalogVideoRepository.activeChildrenWhere(childIds, opts),
      orderBy: [{ order_by: "asc" }, { title: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    });
  },

  /** Count of active children matching the same filter as `listActiveChildren`. */
  countActiveChildren: async (parentId: number, opts?: { search?: string }) => {
    const childIds = await childIdsOf(parentId);
    if (!childIds.length) return 0;
    return prisma.videoCategory.count({ where: catalogVideoRepository.activeChildrenWhere(childIds, opts) });
  },

  /** Shared WHERE for active children list/count — over a pre-resolved child-id set. */
  activeChildrenWhere: (childIds: number[], opts?: { search?: string }) => ({
    id: { in: childIds },
    status: true,
    ...(opts?.search ? { title: { contains: opts.search } } : {}),
  }),

  /**
   * Active child-folder COUNT per parent for the given category ids, over the
   * ws_video_category_relation DAG. Drives both `havingChildDirectory` (count > 0)
   * AND the directory-node `count` (child-folder count) so a folder-with-subfolders
   * reports its subfolder count, not 0 videos. A child folder is counted only if the
   * child category is active.
   */
  childCountsByParent: async (childIds: number[]): Promise<{ parent: number | null; _count: { _all: number } }[]> => {
    if (!childIds.length) return [];
    const edges = await prisma.videoCategoryRelation.findMany({
      where: { parent: { in: childIds } },
      select: { parent: true, child: true },
    });
    if (!edges.length) return [];
    const uniqueChildren = [...new Set(edges.map((e) => e.child))];
    const active = new Set(
      (await prisma.videoCategory.findMany({ where: { id: { in: uniqueChildren }, status: true }, select: { id: true } })).map((r) => r.id)
    );
    // parent → distinct set of its active child folders (dedupes multi-edge pairs).
    const counts = new Map<number, Set<number>>();
    for (const e of edges) {
      if (!e.parent || e.parent <= 0 || !active.has(e.child)) continue;
      let s = counts.get(e.parent);
      if (!s) { s = new Set<number>(); counts.set(e.parent, s); }
      s.add(e.child);
    }
    return [...counts].map(([parent, s]) => ({ parent, _count: { _all: s.size } }));
  },
};
