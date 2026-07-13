import { prisma } from "../../config/prisma";

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
   * Active CHILD categories of a parent (children-nav drill-down). ⚠ Mongo
   * `childCategoryIds[]` is a DAG; SQL derives children from the single `parent`
   * FK (same divergence as admin-master). Optional title search.
   */
  listActiveChildren: (parentId: number, opts?: { search?: string; skip?: number; take?: number }) =>
    prisma.videoCategory.findMany({
      where: catalogVideoRepository.activeChildrenWhere(parentId, opts),
      orderBy: [{ order_by: "asc" }, { title: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),

  /** Count of active children matching the same filter as `listActiveChildren`. */
  countActiveChildren: (parentId: number, opts?: { search?: string }) =>
    prisma.videoCategory.count({ where: catalogVideoRepository.activeChildrenWhere(parentId, opts) }),

  /** Shared WHERE for active children list/count. */
  activeChildrenWhere: (parentId: number, opts?: { search?: string }) => ({
    parent: parentId,
    status: true,
    ...(opts?.search ? { title: { contains: opts.search } } : {}),
  }),

  /**
   * Active child-folder COUNT per parent for the given category ids. Drives both
   * `havingChildDirectory` (count > 0) AND the directory-node `count` (child-folder
   * count) so a folder-with-subfolders reports its subfolder count, not 0 videos.
   */
  childCountsByParent: (childIds: number[]) =>
    childIds.length
      ? prisma.videoCategory.groupBy({ by: ["parent"], where: { parent: { in: childIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([] as { parent: number | null; _count: { _all: number } }[]),
};
