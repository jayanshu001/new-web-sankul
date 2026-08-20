import { prisma } from "../../config/prisma";
import { VIDEO_SCOPE_KINDS, type DownloadScopeKind } from "./offline-video-download.types";

/**
 * Prisma persistence for offline download registrations
 * (`ws_offline_video_download`). Queries only — entitlement, membership and
 * coverage-expansion rules live in the service.
 *
 * `video_id` holds a lecture id for video scopes and the ebook id for `ebook`
 * rows (where it equals `scope_id`).
 */
export const offlineVideoDownloadRepository = {
  /**
   * Idempotent register. The unique key is (customer, video, scope_kind,
   * scope_id), so a repeat download of the same content under the same product
   * refreshes `registered_at` instead of inserting a duplicate — which is what
   * makes the endpoint safe for the app's best-effort retry.
   */
  register: (customerId: number, contentId: number, scopeKind: DownloadScopeKind, scopeId: number, now: Date) =>
    prisma.offlineVideoDownload.upsert({
      where: { uniq_customer_video_scope: { customerId, videoId: contentId, scopeKind, scopeId } },
      create: { customerId, videoId: contentId, scopeKind, scopeId, registeredAt: now, createdAt: now, updatedAt: now },
      update: { registeredAt: now, updatedAt: now },
    }),

  /**
   * Distinct LECTURE ids this customer has registered, across every video scope.
   *
   * The scope the lecture was registered under is deliberately NOT returned: GET
   * re-derives coverage from the customer's CURRENT active products, so which
   * product they happened to download from is irrelevant by then (that is the
   * whole point of expansion). Only the content id survives.
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

  /** Distinct ebook ids this customer has registered. */
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

  // ── existence checks (404 vs 403) ───────────────────────────────────────────
  findVideo: (id: number) =>
    prisma.video.findFirst({ where: { id }, select: { id: true, videoCategoryId: true } }),

  courseExists: (id: number) => prisma.course.findFirst({ where: { id }, select: { id: true } }),
  packageExists: (id: number) => prisma.package.findFirst({ where: { id }, select: { id: true } }),
  liveCourseExists: (id: number) => prisma.liveCourse.findFirst({ where: { id }, select: { id: true } }),
  ebookExists: (id: number) => prisma.eBook.findFirst({ where: { id }, select: { id: true } }),
};
