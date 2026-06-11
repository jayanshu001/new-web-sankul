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

  /** Active categories, ordered by `order_by` then title. */
  listActiveCategories: () =>
    prisma.videoCategory.findMany({
      where: { status: true },
      orderBy: [{ order_by: "asc" }, { title: "asc" }],
    }),
};
