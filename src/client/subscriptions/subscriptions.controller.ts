import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import * as offlineDl from "../../modules/offline-video-download/offline-video-download.service";
import {
  DOWNLOAD_SCOPE_KINDS,
  type DownloadScopeKind,
} from "../../modules/offline-video-download/offline-video-download.types";
import { syncEntitlementCache } from "../../utils/entitlementWatch";

const KIND_VALUES = ["course", "package", "liveCourse", "ebook"] as const;
const KINDS_MESSAGE = "Invalid `kinds`. Allowed: course, package, liveCourse, ebook.";

// Ids arrive as strings (the client API is id-as-string throughout) but every
// SQL id is a positive int — coerce once here so the service never re-parses.
const idString = z
  .string()
  .trim()
  .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, "Must be a positive numeric id");

const bodySchema = z
  .object({
    // Named `videoId` for app compatibility; for `kind: "ebook"` it carries the
    // ebook id, which must equal `id` (the ebook is its own container).
    videoId: idString,
    kind: z.enum(KIND_VALUES),
    id: idString,
  })
  .refine((b) => b.kind !== "ebook" || b.videoId === b.id, {
    path: ["videoId"],
    message: "For kind `ebook`, `videoId` must equal `id`.",
  });

// `kinds` is an optional CSV filter; omitted → all four. An unknown kind is a
// 422 rather than a silent no-op, so a typo in the app can't return an empty
// snapshot that the FE would read as "everything was revoked" and delete files.
const querySchema = z.object({
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(KIND_VALUES)).nonempty().optional()),
});

// POST /api/v1/client/subscriptions/downloads
//
// Called after a PAID lecture or ebook finishes downloading, to record what was
// downloaded and which product the user was looking at when they tapped it.
//
// The app sends exactly ONE product — the one on screen. It has no way to know
// which other courses/packages also contain that lecture, and it is explicitly
// not asked to: GET re-derives the full covering set itself (see the service).
// So this is a record of the download, not a declaration of entitlement.
//
// Best-effort from the FE's side — a failure here must not undo the local file —
// so the response stays small and the errors are precise enough for the app to
// decide whether to retry (5xx) or give up (403/404).
export const registerOfflineDownload = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("registerOfflineDownload invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) {
      logger.warn("registerOfflineDownload unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      const messages: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "body");
        if (!messages[field]) messages[field] = issue.message;
      }
      logger.warn("registerOfflineDownload validation failed", { traceId, customerId: userId, issues: parsed.error.issues });
      // 400, not the platform-default 422: the FE spec pins this body to 400.
      return failure(res, "Invalid request body.", 400, messages);
    }

    const customerId = Number(userId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      logger.warn("registerOfflineDownload non-numeric customer", { traceId, customerId: userId });
      return failure(res, "Unauthorized.", 401);
    }

    const result = await offlineDl.registerDownload(
      {
        customerId,
        contentId: Number(parsed.data.videoId),
        kind: parsed.data.kind,
        scopeId: Number(parsed.data.id),
      },
      new Date(),
    );

    if (!result.ok) {
      // 404 = the thing does not exist; 403 = it exists but this user may not
      // claim it. The FE treats both as terminal (no retry), but they mean
      // different bugs, so they stay distinguishable.
      const [status, message] = {
        content_not_found: [404, "Video not found."],
        product_not_found: [404, "Product not found."],
        not_entitled: [403, "You do not have an active subscription for this product."],
        content_not_in_product: [403, "This video is not part of the given product."],
      }[result.reason] as [number, string];

      logger.warn("registerOfflineDownload refused", { traceId, customerId, reason: result.reason, kind: parsed.data.kind, productId: parsed.data.id, videoId: parsed.data.videoId });
      return failure(res, message, status);
    }

    logger.info("registerOfflineDownload success", { traceId, customerId, ...result.dto });
    return success(res, result.dto, "Offline download registered");
  } catch (e: any) {
    logger.error("registerOfflineDownload failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return failure(res, "Could not register offline download.", 500);
  }
};

// GET /api/v1/client/subscriptions/access
//
// End times for every product this user is still entitled to that COVERS at least
// one video they registered a download for. Not their whole subscription list — a
// course containing none of their downloads has no offline file to govern, so it
// has no row here — and not only the products they registered under either: the
// app can POST just one product per file, so the other owners of a shared video
// are expanded server-side. Each row carries the `videoIds` it covers.
// Contract and FE usage: docs/client/SUBSCRIPTION_ACCESS.md.
//
// Two properties this endpoint must never lose:
//   1. "Still entitled" is decided by the SAME builders that back
//      GET /client/my-subscriptions (see activeEntitlements in the service). An
//      admin revoke drops the product from both in the same request — a stale
//      row here means a revoked download keeps playing.
//   2. It is NOT cacheRoute-wrapped. A TTL would re-introduce exactly that
//      staleness for the length of the TTL. The FE calls this on cold start and
//      on every foreground; those reads must hit the DB.
export const getSubscriptionAccess = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getSubscriptionAccess invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) {
      logger.warn("getSubscriptionAccess unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      logger.warn("getSubscriptionAccess validation failed", { traceId, customerId: userId, issues: parsed.error.issues });
      return failure(res, KINDS_MESSAGE, 422, { kinds: KINDS_MESSAGE });
    }

    const kinds: DownloadScopeKind[] = parsed.data.kinds ?? DOWNLOAD_SCOPE_KINDS;
    const now = new Date();
    const customerId = Number(userId);

    const items =
      Number.isInteger(customerId) && customerId > 0
        ? await offlineDl.buildAccessSnapshot(customerId, now, kinds)
        : [];

    // Same change-detector My Subscriptions runs, on its own fingerprint key.
    // The app hits this on every foreground, so it is in practice the fastest
    // path to noticing a revoke/expiry and sweeping this customer's 24h-cached
    // catalog overlay (isPurchased/daysLeft). Fail-open by design.
    //
    // Only fingerprint the UNFILTERED snapshot — a `kinds`-filtered set is a
    // subset and would otherwise look like a mass revoke and flush every time.
    // Note this set is download-scoped: it covers every active product holding a
    // registered video (wider than the registered scopes since the expansion, but
    // still not every subscription), so products the user has never downloaded
    // from are detected by the My Subscriptions screen instead.
    if (Number.isInteger(customerId) && customerId > 0 && !parsed.data.kinds) {
      await syncEntitlementCache(
        customerId,
        "access",
        items.map((i) => ({ kind: i.kind, id: i.id, endAt: i.endAt ? new Date(i.endAt) : null })),
      );
    }

    logger.info("getSubscriptionAccess success", { traceId, customerId: userId, kinds, returned: items.length });
    return success(res, { syncedAt: now.toISOString(), items });
  } catch (e: any) {
    logger.error("getSubscriptionAccess failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return failure(res, "Could not load subscription access.", 500);
  }
};
