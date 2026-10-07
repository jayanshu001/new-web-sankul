// Entitlement watch: self-healing invalidation for the per-user `isPurchased` overlay.
//
// Client catalog GETs are cached per user for 24h and admin grant/revoke writes
// call `flushUserRouteCache`, but that misses natural expiry (`end_at` passing
// is not a write), direct SQL edits, backfill scripts and BullMQ jobs.
// `/client/my-subscriptions` is cached for only 30s, so it recomputes the live
// entitlement set every ~30s; fingerprinting that set and sweeping the
// customer's cached reads when it changes caps staleness at ~30s for every cause.
//
// Limitation: it only fires when the app calls my-subscriptions. A client that
// never hits that endpoint keeps its stale overlay until the 24h TTL lapses.

import { redisClient, isRedisReady } from "../config/redis";
import { flushUserRouteCache } from "../middlewares/autoFlush";
import logger from "./logger";

/** Comfortably longer than the 24h route TTL it guards. */
const FP_TTL_SECONDS = 7 * 24 * 60 * 60;

const fpKey = (customerId: number | string, type: string) =>
  `entitlement_fp:${customerId}:${type}`;

/**
 * `endAt` is included so a shortened window is caught. `daysLeft` is deliberately
 * excluded: it changes daily and would force a pointless flush for every user.
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
 * Sweeps the customer's cached reads when the entitlement set changed since the
 * last call. Fails open (never breaks My Subscriptions). The first call for a
 * customer+type only records a baseline, so a deploy or cold Redis doesn't
 * stampede every user's cache.
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
