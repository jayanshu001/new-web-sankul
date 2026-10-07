// Client subscription access: offline download registration and entitlement snapshot.
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

// Ids arrive as strings but every SQL id is a positive int — coerce once here.
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

// `kinds` is an optional CSV filter (omitted → all). An unknown kind is a 422, so a
// typo can't return an empty snapshot the FE would read as "all revoked" and delete files.
const querySchema = z.object({
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(KIND_VALUES)).nonempty().optional()),
});

// Records a PAID lecture/ebook download plus the ONE product on screen. Not a
// declaration of entitlement: GET re-derives every covering product itself.
// Best-effort for the FE (a failure must not undo the local file), so errors are
// precise enough to decide between retry (5xx) and give up (403/404).
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
      // 404 = does not exist; 403 = exists but this user may not claim it. Both are
      // terminal for the FE but signal different bugs.
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

// End times for every still-entitled product that covers at least one registered
// download video (expanded server-side to all owners of a shared video), each with
// the `videoIds` it covers. Contract: docs/client/SUBSCRIPTION_ACCESS.md.
// Invariants:
//   1. "Still entitled" uses the same builders as GET /client/my-subscriptions, so
//      an admin revoke drops the product from both at once.
//   2. Not cacheRoute-wrapped: a TTL would let a revoked download keep playing. The
//      FE calls this on cold start and every foreground.
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

    // Same change-detector as My Subscriptions on its own fingerprint key; the fastest
    // path to sweeping this customer's cached catalog overlay after a revoke/expiry.
    // Fail-open. Only the unfiltered snapshot is fingerprinted — a `kinds` subset would
    // look like a mass revoke. The set is download-scoped, so products never downloaded
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
