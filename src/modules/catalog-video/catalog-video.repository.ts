// Video catalog: Prisma queries.
import { prisma } from "../../config/prisma";
import { childIdsOf } from "../../utils/videoCategoryRelation";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const catalogVideoRepository = {
  findVideoById: (id: number) =>
    prisma.video.findFirst({ where: { id, status: true } }),

  listActiveVideosByCategory: (videoCategoryId: number) =>
    prisma.video.findMany({
      where: { status: true, videoCategoryId },
      orderBy: [{ order: "asc" }, { created_at: "asc" }],
    }),

  /** categoryId → direct active video count for every id, in one query. */
  countActiveVideosByCategories: async (videoCategoryIds: number[]): Promise<Map<number, number>> => {
    if (!videoCategoryIds.length) return new Map();
    const rows = await prisma.video.groupBy({ by: ["videoCategoryId"], where: { status: true, videoCategoryId: { in: videoCategoryIds } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.videoCategoryId as number, r._count._all]));
  },

  findCategoryById: (id: number) =>
    prisma.videoCategory.findFirst({ where: { id, status: true } }),

  /** No status gate: used for the parent of a children lookup. */
  findCategoryByIdAny: (id: number) =>
    prisma.videoCategory.findFirst({ where: { id } }),

  listActiveCategories: () =>
    prisma.videoCategory.findMany({
      where: { status: true },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    }),

  /**
   * Active CHILD categories of a parent (children-nav drill-down). Children come
   * from ws_video_category_relation (the DAG edge table); the returned rows are then
   * filtered to active + optional title search and paginated. Ordered by order_by.
   */
  // Page + total share ONE child-id resolution (it used to run once for each).
  listActiveChildrenPage: async (parentId: number, opts?: { search?: string; skip?: number; take?: number }) => {
    const childIds = await childIdsOf(parentId);
    if (!childIds.length) return { rows: [], total: 0 };
    const where = catalogVideoRepository.activeChildrenWhere(childIds, opts);
    const [rows, total] = await Promise.all([
      prisma.videoCategory.findMany({
        where,
        orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
      prisma.videoCategory.count({ where }),
    ]);
    return { rows, total };
  },

  activeChildrenWhere: (childIds: number[], opts?: { search?: string }) => ({
    id: { in: childIds },
    status: true,
    ...(buildPrismaSearch(opts?.search, ["title"]) ?? {}),
  }),

  /**
   * Active child-folder count per parent over the ws_video_category_relation DAG.
   * Drives both `havingChildDirectory` and the directory-node `count`, so a folder
   * with subfolders reports its subfolder count rather than 0 videos.
   */
  childCountsByParent: async (childIds: number[]): Promise<{ parent: number | null; _count: { _all: number } }[]> => {
    if (!childIds.length) return [];
    // Active-child filter joined in the same query (was a second round-trip).
    const edges = await prisma.videoCategoryRelation.findMany({
      where: { parent: { in: childIds }, childVideoCategory: { is: { status: true } } },
      select: { parent: true, child: true },
    });
    // parent → distinct set of its active child folders (dedupes multi-edge pairs).
    const counts = new Map<number, Set<number>>();
    for (const e of edges) {
      if (!e.parent || e.parent <= 0) continue;
      let s = counts.get(e.parent);
      if (!s) { s = new Set<number>(); counts.set(e.parent, s); }
      s.add(e.child);
    }
    return [...counts].map(([parent, s]) => ({ parent, _count: { _all: s.size } }));
  },
};
