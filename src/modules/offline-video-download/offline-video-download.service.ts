/**
 * Offline downloads — registration + the access snapshot that governs expiry.
 *
 * The app downloads paid lectures and ebooks for offline use and must expire them
 * against the subscription that grants access, with no network at playback.
 *
 * The shape of the problem: a lecture can live in a course, a package AND a live
 * course at once, but the app only knows the ONE product the user was looking at
 * when they tapped download. It cannot discover the others. So:
 *
 *   POST registers a single {content, product} pair — whatever the user saw.
 *   GET  ignores that product and re-derives coverage from scratch: every
 *        currently-active product of the customer's that CONTAINS a registered
 *        lecture, each carrying the registered ids it covers (`videoIds`).
 *
 * That asymmetry is the whole design. If GET echoed back only the POSTed product,
 * a user who downloaded from Course A while also owning Package B would lose the
 * file the moment Course A expired — even though Package B still entitles the
 * very same lecture. Expansion is what keeps the file alive.
 *
 * Ebooks are the degenerate case: the ebook IS the content, so there is nothing
 * to expand into. `{videoId: E, kind: "ebook", id: E}` in, one `ebook` row out.
 *
 * Contract + FE usage: docs/client/SUBSCRIPTION_ACCESS.md.
 */
import { offlineVideoDownloadRepository as repo } from "./offline-video-download.repository";
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

export const OFFLINE_VIDEO_DOWNLOAD_MODULE = "offline-video-download";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysLeftOf = (endAt: Date | null, now: Date) =>
  endAt ? Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / MS_PER_DAY)) : null;

interface ActiveProduct {
  kind: DownloadScopeKind;
  id: number;
  endAt: Date | null;
}

/**
 * The customer's currently-active entitlements.
 *
 * DELIBERATELY built from the SAME `build*Cards` functions that back
 * GET /client/my-subscriptions — not a parallel "is active" query. That is the
 * contract the FE asked for: a product that disappears from My Subscriptions
 * MUST disappear from the access snapshot in the very same request, because both
 * are the same computation. Do not "optimise" this into its own repository call;
 * the two would drift the first time either active-filter changed, and a revoked
 * offline download would keep playing.
 *
 * Carries the active filters those builders already own:
 *   course/package → status = true AND end_at > now
 *   liveCourse     → status = true AND payment_status = "verified"
 *                    AND (end_at IS NULL OR end_at > now)   ← lifetime allowed
 *   ebook          → status = true AND end_at > now
 * plus their dedup (furthest end_at per product wins; lifetime beats dated).
 *
 * Only the builders the caller's `kinds` actually need are run.
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

/** Does the product exist at all? Separates 404 (unknown product) from 403. */
const productExists = async (kind: DownloadScopeKind, id: number): Promise<boolean> => {
  const row =
    kind === "course" ? await repo.courseExists(id)
      : kind === "package" ? await repo.packageExists(id)
        : kind === "liveCourse" ? await repo.liveCourseExists(id)
          : await repo.ebookExists(id);
  return row !== null;
};

/**
 * Register one offline download. Idempotent on (customer, content, kind, id).
 *
 * Check order matters — it decides 404 vs 403, and the FE branches on that:
 *   1. content missing            → 404
 *   2. product missing            → 404
 *   3. no active subscription     → 403
 *   4. lecture not in the product → 403   (video scopes only)
 *
 * (3) uses the SAME active set the snapshot uses, so a registration can never
 * succeed for a product the very next GET would omit.
 *
 * (4) uses `reachableCategoryIds`, the same resolver that decides which videos
 * `/client/catalog/:type/:id/videos` lists under the product — so a lecture the
 * app was legitimately able to show and download always passes. It is a superset
 * of the catalog listing's own root resolution, never narrower, which is what
 * keeps this from 403-ing a real download and stranding the file.
 *
 * For `ebook` there is no (4): the ebook is the content, and the controller has
 * already enforced `videoId === id`.
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

    // A lecture with no category cannot be proven to belong anywhere — reject
    // rather than register coverage the snapshot could never justify.
    if (video.videoCategoryId == null) return { ok: false, reason: "content_not_in_product" };
    const reachable = await reachableCategoryIds(kind, scopeId);
    if (!reachable.has(video.videoCategoryId)) return { ok: false, reason: "content_not_in_product" };
  } else {
    // ebook: contentId === scopeId (controller-enforced), so one existence check
    // covers both "unknown content" and "unknown product".
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
      // UTC `...Z`, matching `endAt` in the snapshot — see buildAccessSnapshot.
      registeredAt: now.toISOString(),
    },
  };
};

/**
 * GET /client/subscriptions/access — every active product that still COVERS a
 * registered download, with the ids it covers.
 *
 * Deliberately NOT "the products they POSTed under". Coverage is recomputed from
 * the customer's current entitlements on every read, so:
 *   - a lecture registered under Course A also surfaces Package B while B is
 *     active, without the app ever POSTing B (the expansion requirement);
 *   - when A expires the file survives on B's row alone;
 *   - when the last covering product goes, the id appears in no `videoIds` and
 *     the app deletes the file;
 *   - an active product containing no registered lecture never appears at all.
 *
 * The registration row is history — it records that a download happened, never
 * that access persists. Entitlement is decided fresh here every time.
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

  // Nothing downloaded → nothing to govern. Costs the two index reads above and
  // skips the entitlement builders entirely, which is the common case for users
  // who never download offline.
  if (!videoIds.length && !ebookIds.length) return [];

  const active = await activeProducts(customerId, now, want);
  const items: SubscriptionAccessItem[] = [];

  // ── videos: expand across every active product whose curriculum covers one ──
  if (videoIds.length) {
    const catOf = new Map(
      (await repo.videoCategories(videoIds)).map((v) => [v.id, v.videoCategoryId]),
    );

    // One reachability walk per active video product. `reachableCategoryIds` is
    // reused rather than inlined so GET's coverage test and POST's membership
    // check can never disagree about what "in this product" means — a drift
    // there would either strand files or keep revoked ones playable.
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

  // ── ebooks: no expansion, the ebook IS its own content ──────────────────────
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
