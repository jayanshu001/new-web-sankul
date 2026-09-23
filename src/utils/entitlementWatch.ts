// src/utils/entitlementWatch.ts
//
// Self-healing invalidation for the per-user `isPurchased` overlay.
//
// WHY THIS EXISTS
// ---------------
// Client catalog GETs are cached per user for 24h (`cacheRoute`, scope "user"),
// and every admin write that grants or revokes access calls
// `flushUserRouteCache`. That covers writes that go through our API — but NOT:
//
//   - **natural expiry** — when `end_at` simply passes there is no write at all,
//     so there is nothing to hang a flush on. This is the big one: it is
//     indistinguishable from the original "admin ended it and nothing updated"
//     bug, and no amount of flush-wiring can fix it.
//   - direct SQL edits, backfill scripts, and BullMQ jobs, which bypass route
//     middleware entirely.
//   - any future write path where someone forgets the flush.
//
// `/client/my-subscriptions` is cached for only 30s, so it recomputes the user's
// live entitlement set roughly every half-minute regardless of WHY that set
// changed. That makes it a natural change-detector: fingerprint the set it just
// computed, compare against the last fingerprint, and when it differs sweep that
// customer's other cached reads. The next catalog fetch is then a clean MISS.
//
// Net effect: worst-case staleness on the 24h routes drops from 24h to ~30s
// (my-subscriptions' own TTL) for EVERY cause of entitlement change, without
// touching those routes' TTLs and without a per-request DB cost.
//
// LIMITATION worth knowing: this only fires when the app actually calls
// my-subscriptions. A client that opens a detail screen without ever hitting
// that endpoint keeps its stale overlay until the 24h TTL lapses. In practice
// the app loads it on the profile/library screens, so it self-heals quickly —
// but it is a heuristic, not a guarantee.

import { redisClient, isRedisReady } from "../config/redis";
import { flushUserRouteCache } from "../middlewares/autoFlush";
import logger from "./logger";

/** How long a fingerprint lives. Comfortably longer than the 24h route TTL it guards. */
const FP_TTL_SECONDS = 7 * 24 * 60 * 60;

const fpKey = (customerId: number | string, type: string) =>
  `entitlement_fp:${customerId}:${type}`;

/**
 * One entitlement, reduced to the parts that decide `isPurchased` / `daysLeft`.
 *
 * `endAt` is included so an admin *shortening* a window (rather than revoking
 * it) is also caught. `daysLeft` deliberately is NOT — it decrements every day
 * on its own and would force a pointless daily flush for every active user.
 */
export interface EntitlementFingerprintInput {
  kind: string;
  id: unknown;
  endAt: Date | null;
}

/** Order-independent fingerprint: same set → same string, however it was sorted. */
export const buildEntitlementFingerprint = (
  items: EntitlementFingerprintInput[],
): string =>
  items
    .map((i) => `${i.kind}:${String(i.id ?? "")}:${i.endAt ? i.endAt.getTime() : "inf"}`)
    .sort()
    .join("|");

/**
 * Compare this request's entitlement set against the last one seen and sweep the
 * customer's cached reads when it changed.
 *
 * Fail-open and non-blocking on error: entitlement detection must never break
 * the My Subscriptions screen. On the FIRST ever call for a customer+type there
 * is no stored fingerprint — we record it WITHOUT flushing, so a deploy or a
 * cold Redis doesn't stampede every user's cache at once.
 *
 * @returns how many cache keys were cleared (0 when unchanged or on error).
 */
export const syncEntitlementCache = async (
  customerId: number | string,
  type: string,
  items: EntitlementFingerprintInput[],
): Promise<number> => {
  if (!isRedisReady()) return 0;

  const key = fpKey(customerId, type);
  const next = buildEntitlementFingerprint(items);

  try {
    const prev = await redisClient.get(key);
    await redisClient.set(key, next, "EX", FP_TTL_SECONDS);

    // First sighting → baseline only, nothing to invalidate yet.
    if (prev === null || prev === next) return 0;

    const cleared = await flushUserRouteCache(customerId);
    logger.info("entitlement change detected → per-user cache swept", {
      customerId,
      type,
      cleared,
    });
    return cleared;
  } catch (err) {
    logger.warn("syncEntitlementCache failed (ignored)", {
      customerId,
      type,
      err: (err as Error).message,
    });
    return 0;
  }
};
