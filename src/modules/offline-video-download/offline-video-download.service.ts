/**
 * Offline downloads: registration + the access snapshot that governs expiry.
 *
 * A lecture can live in a course, a package and a live course at once, but the app
 * only knows the one product the user tapped download from. So POST registers a
 * single {content, product} pair, and GET ignores that product and re-derives
 * coverage: every currently-active product that contains a registered lecture,
 * with the ids it covers (`videoIds`). Without that expansion, a user who
 * downloaded from Course A while owning Package B would lose the file when A
 * expired. Ebooks have nothing to expand: one `ebook` row in, one out.
 *
 * Contract + FE usage: docs/client/SUBSCRIPTION_ACCESS.md.
 */
import { offlineVideoDownloadRepository as repo } from "./offline-video-download.repository";
import { computeDaysLeft } from "../../utils/planDuration";
import * as mySubSql from "../client-my-subscriptions/client-my-subscriptions.service";
import { reachableCategoryIds } from "../catalog-category-tree/category-tree.service";
import {
  isVideoScopeKind,
  type DownloadScopeKind,
  type RegisterDownloadInput,
  type RegisterResult,
  type SubscriptionAccessItem,
  type VideoScopeKind,
} from "./offline-video-download.types";

const daysLeftOf = computeDaysLeft;

interface ActiveProduct {
  kind: DownloadScopeKind;
  id: number;
  endAt: Date | null;
}

/**
 * The customer's currently-active entitlements, built from the same `build*Cards`
 * functions that back GET /client/my-subscriptions. Do not replace this with a
 * separate query: a product that leaves My Subscriptions must leave the access
 * snapshot in the same request, or a revoked download keeps playing.
 *
 * Active filters (owned by those builders):
 *   course/package → status = true AND end_at > now
 *   liveCourse     → status = true AND payment_status = "verified"
 *                    AND (end_at IS NULL OR end_at > now)   ← lifetime allowed
 *   ebook          → status = true AND end_at > now
 * plus their dedup (furthest end_at per product wins; lifetime beats dated).
 * Only the builders the caller's `kinds` need are run.
 */
const activeProducts = async (
  customerId: number,
  now: Date,
  kinds: Set<DownloadScopeKind>,
): Promise<ActiveProduct[]> => {
  const [courseAndPackage, liveCourse, ebook] = await Promise.all([
    kinds.has("course") || kinds.has("package")
      ? mySubSql.buildCourseAndPackageCards(customerId, now)
      : Promise.resolve([]),
    kinds.has("liveCourse") ? mySubSql.buildLiveCourseCards(customerId, now) : Promise.resolve([]),
    kinds.has("ebook") ? mySubSql.buildEbookCards(customerId, now) : Promise.resolve([]),
  ]);

  // Card `action.kind` → the client-facing kind. Only `live_course` differs.
  const out: ActiveProduct[] = [];
  for (const card of [...courseAndPackage, ...liveCourse, ...ebook]) {
    const kind: DownloadScopeKind | null =
      card.action.kind === "course" ? "course"
        : card.action.kind === "package" ? "package"
          : card.action.kind === "live_course" ? "liveCourse"
            : card.action.kind === "ebook" ? "ebook"
              : null;
    if (!kind || !kinds.has(kind)) continue;

    const id = card.action.courseId ?? card.action.packageId ?? card.action.liveCourseId ?? card.action.ebookId;
    if (!id) continue;
    out.push({ kind, id: Number(id), endAt: card.endAt ?? null });
  }
  return out;
};

/** Separates 404 (unknown product) from 403. */
const productExists = async (kind: DownloadScopeKind, id: number): Promise<boolean> => {
  const row =
    kind === "course" ? await repo.courseExists(id)
      : kind === "package" ? await repo.packageExists(id)
        : kind === "liveCourse" ? await repo.liveCourseExists(id)
          : await repo.ebookExists(id);
  return row !== null;
};

/**
 * Register one offline download. Check order decides 404 vs 403, which the FE branches on:
 *   1. content missing            → 404
 *   2. product missing            → 404
 *   3. no active subscription     → 403
 *   4. lecture not in the product → 403   (video scopes only)
 *
 * (3) uses the same active set as the snapshot, so a registration never succeeds
 * for a product the next GET would omit. (4) uses `reachableCategoryIds`, the same
 * resolver behind `/client/catalog/:type/:id/videos` (a superset, never narrower),
 * so a lecture the app could legitimately show always passes.
 * `ebook` has no (4); the controller already enforces `videoId === id`.
 */
export const registerDownload = async (
  input: RegisterDownloadInput,
  now: Date,
): Promise<RegisterResult> => {
  const { customerId, contentId, kind, scopeId } = input;

  if (isVideoScopeKind(kind)) {
    const video = await repo.findVideo(contentId);
    if (!video) return { ok: false, reason: "content_not_found" };

    if (!(await productExists(kind, scopeId))) return { ok: false, reason: "product_not_found" };

    const active = await activeProducts(customerId, now, new Set([kind]));
    if (!active.some((p) => p.kind === kind && p.id === scopeId)) {
      return { ok: false, reason: "not_entitled" };
    }

    // A lecture with no category cannot be proven to belong anywhere.
    if (video.videoCategoryId == null) return { ok: false, reason: "content_not_in_product" };
    const reachable = await reachableCategoryIds(kind, scopeId);
    if (!reachable.has(video.videoCategoryId)) return { ok: false, reason: "content_not_in_product" };
  } else {
    // ebook: contentId === scopeId (controller-enforced), so one check covers content and product.
    if (!(await repo.ebookExists(scopeId))) return { ok: false, reason: "product_not_found" };

    const active = await activeProducts(customerId, now, new Set<DownloadScopeKind>(["ebook"]));
    if (!active.some((p) => p.kind === "ebook" && p.id === scopeId)) {
      return { ok: false, reason: "not_entitled" };
    }
  }

  await repo.register(customerId, contentId, kind, scopeId, now);

  return {
    ok: true,
    dto: {
      videoId: String(contentId),
      kind,
      id: String(scopeId),
      // UTC `...Z`, matching `endAt` in the snapshot.
      registeredAt: now.toISOString(),
    },
  };
};

/**
 * GET /client/subscriptions/access: every active product that still covers a
 * registered download, with the ids it covers. Recomputed from current
 * entitlements on every read, not from the POSTed products:
 *   - a lecture registered under Course A also surfaces Package B while B is active;
 *   - when A expires the file survives on B's row alone;
 *   - when the last covering product goes, the id appears in no `videoIds` and
 *     the app deletes the file;
 *   - an active product containing no registered lecture never appears.
 * The registration row records that a download happened, never that access persists.
 */
export const buildAccessSnapshot = async (
  customerId: number,
  now: Date,
  kinds: DownloadScopeKind[],
): Promise<SubscriptionAccessItem[]> => {
  const want = new Set(kinds);
  const wantsVideo = kinds.some(isVideoScopeKind);

  const [videoIds, ebookIds] = await Promise.all([
    wantsVideo ? repo.registeredVideoIds(customerId) : Promise.resolve([]),
    want.has("ebook") ? repo.registeredEbookIds(customerId) : Promise.resolve([]),
  ]);

  // Nothing downloaded: skip the entitlement builders (the common case).
  if (!videoIds.length && !ebookIds.length) return [];

  const active = await activeProducts(customerId, now, want);
  const items: SubscriptionAccessItem[] = [];

  if (videoIds.length) {
    const catOf = new Map(
      (await repo.videoCategories(videoIds)).map((v) => [v.id, v.videoCategoryId]),
    );

    // Shared with POST's membership check so the two can never disagree about
    // what "in this product" means (drift would strand files or keep revoked ones playable).
    const videoScopes = active.filter((p): p is ActiveProduct & { kind: VideoScopeKind } =>
      isVideoScopeKind(p.kind),
    );
    const reachSets = await Promise.all(
      videoScopes.map((p) => reachableCategoryIds(p.kind, p.id)),
    );

    videoScopes.forEach((p, i) => {
      const reachable = reachSets[i];
      const covered = videoIds.filter((vid) => {
        const cat = catOf.get(vid);
        return cat != null && reachable.has(cat);
      });
      if (!covered.length) return; // product covers nothing registered → omit
      items.push({
        kind: p.kind,
        id: String(p.id),
        endAt: p.endAt ? p.endAt.toISOString() : null,
        daysLeft: daysLeftOf(p.endAt, now),
        videoIds: covered.map(String).sort(),
      });
    });
  }

  if (ebookIds.length) {
    const registered = new Set(ebookIds);
    for (const p of active) {
      if (p.kind !== "ebook" || !registered.has(p.id)) continue;
      items.push({
        kind: "ebook",
        id: String(p.id),
        endAt: p.endAt ? p.endAt.toISOString() : null,
        daysLeft: daysLeftOf(p.endAt, now),
        videoIds: [String(p.id)],
      });
    }
  }

  // Soonest-expiring first; lifetime rows (endAt null) last.
  return items.sort(
    (a, b) =>
      (a.endAt ? Date.parse(a.endAt) : Infinity) - (b.endAt ? Date.parse(b.endAt) : Infinity),
  );
};
