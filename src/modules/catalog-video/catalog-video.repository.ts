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

  countActiveVideosByCategory: (videoCategoryId: number) =>
    prisma.video.count({ where: { status: true, videoCategoryId } }),

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

  /** Children come from the ws_video_category_relation DAG, not the legacy `parent` column. */
  listActiveChildren: async (parentId: number, opts?: { search?: string; skip?: number; take?: number }) => {
    const childIds = await childIdsOf(parentId);
    if (!childIds.length) return [];
    return prisma.videoCategory.findMany({
      where: catalogVideoRepository.activeChildrenWhere(childIds, opts),
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    });
  },

  countActiveChildren: async (parentId: number, opts?: { search?: string }) => {
    const childIds = await childIdsOf(parentId);
    if (!childIds.length) return 0;
    return prisma.videoCategory.count({ where: catalogVideoRepository.activeChildrenWhere(childIds, opts) });
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
    const edges = await prisma.videoCategoryRelation.findMany({
      where: { parent: { in: childIds } },
      select: { parent: true, child: true },
    });
    if (!edges.length) return [];
    const uniqueChildren = [...new Set(edges.map((e) => e.child))];
    const active = new Set(
      (await prisma.videoCategory.findMany({ where: { id: { in: uniqueChildren }, status: true }, select: { id: true } })).map((r) => r.id)
    );
  // Sets dedupe multi-edge parent/child pairs.
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
