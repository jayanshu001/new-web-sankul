// Offline downloads: Prisma queries.
import { prisma } from "../../config/prisma";
import { VIDEO_SCOPE_KINDS, type DownloadScopeKind } from "./offline-video-download.types";

/** `video_id` holds a lecture id for video scopes and the ebook id (= `scope_id`) for `ebook` rows. */
export const offlineVideoDownloadRepository = {
  /**
   * Idempotent on (customer, video, scope_kind, scope_id): a repeat refreshes
   * `registered_at` instead of inserting, so the app's best-effort retry is safe.
   */
  register: (customerId: number, contentId: number, scopeKind: DownloadScopeKind, scopeId: number, now: Date) =>
    prisma.offlineVideoDownload.upsert({
      where: { uniq_customer_video_scope: { customerId, videoId: contentId, scopeKind, scopeId } },
      create: { customerId, videoId: contentId, scopeKind, scopeId, registeredAt: now, createdAt: now, updatedAt: now },
      update: { registeredAt: now, updatedAt: now },
    }),

  /**
   * Distinct lecture ids across every video scope. The registering scope is not
   * returned: GET re-derives coverage from the customer's current active products.
   */
  registeredVideoIds: async (customerId: number): Promise<number[]> => {
    const rows = await prisma.offlineVideoDownload.findMany({
      // Explicit `in` rather than `{ not: "ebook" }` — Prisma's `not` silently
      // excludes NULL rows, and an `in` list states the intent directly.
      where: { customerId, scopeKind: { in: VIDEO_SCOPE_KINDS } },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    return rows.map((r) => r.videoId);
  },

  registeredEbookIds: async (customerId: number): Promise<number[]> => {
    const rows = await prisma.offlineVideoDownload.findMany({
      where: { customerId, scopeKind: "ebook" },
      distinct: ["scopeId"],
      select: { scopeId: true },
    });
    return rows.map((r) => r.scopeId);
  },

  /** Leaf category per registered lecture — the key the coverage test joins on. */
  videoCategories: (ids: number[]) =>
    ids.length
      ? prisma.video.findMany({ where: { id: { in: ids } }, select: { id: true, videoCategoryId: true } })
      : Promise.resolve([]),

  findVideo: (id: number) =>
    prisma.video.findFirst({ where: { id }, select: { id: true, videoCategoryId: true } }),

  courseExists: (id: number) => prisma.course.findFirst({ where: { id }, select: { id: true } }),
  packageExists: (id: number) => prisma.package.findFirst({ where: { id }, select: { id: true } }),
  liveCourseExists: (id: number) => prisma.liveCourse.findFirst({ where: { id }, select: { id: true } }),
  ebookExists: (id: number) => prisma.eBook.findFirst({ where: { id }, select: { id: true } }),
};
