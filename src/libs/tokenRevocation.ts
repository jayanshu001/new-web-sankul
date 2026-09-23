// src/libs/tokenRevocation.ts
//
// Revoke-by-cutoff token revocation list, backed by Redis.
//
// Design: instead of storing a per-token `jti` (which would require both a
// new claim on every issued token AND a Redis SET membership check on every
// authenticate call), we store a single per-user cutoff timestamp. Any
// token with `iat * 1000 < cutoff` is considered revoked.
//
// Properties:
//   - No token format change. Works with every JWT we've ever signed, since
//     `iat` is a standard claim auto-included by jsonwebtoken.
//   - Cheap to check: one Redis GET per authenticate call (and only when the
//     key exists for that user — which it usually doesn't).
//   - Coarse: revokes ALL of a user's outstanding tokens at once. That's
//     exactly the contract for "log out all devices" / "password changed,
//     invalidate everything." For finer-grain revocation (single device) you
//     still use the existing one-active-device Redis session keys.
//   - TTL bounded: the cutoff key auto-expires after the longest refresh
//     token TTL, because by then every token issued before the cutoff has
//     expired naturally anyway.

import { redisClient, isRedisReady } from "../config/redis";
import logger from "../utils/logger";

export type UserType = "customer" | "admin" | "educator" | "promoter";

// Matches the refresh-token TTLs in each auth service. We use the LONGEST
// (customer: 60d) as the safe upper bound so we never expire the cutoff
// while there's still a refresh token alive that pre-dates it.
const CUTOFF_TTL_SECONDS = 60 * 24 * 60 * 60;

const cutoffKey = (type: UserType, userId: string): string =>
  `revoke:${type}:${userId}`;

/**
 * Revoke every token issued for this user before `Date.now()`. Subsequent
 * `isRevoked()` checks return true for any token with `iat < now`.
 *
 * Fail-open: if Redis is unreachable, returns false. We log loudly and the
 * caller's logout-all-devices request still succeeds (the database-side
 * single-device session pointer flip remains the primary defense). When
 * Redis comes back, future logins will use the new pointer naturally.
 */
export const revokeAllTokensForUser = async (
  type: UserType,
  userId: string
): Promise<boolean> => {
  if (!isRedisReady()) {
    logger.warn("tokenRevocation: Redis not ready; revoke noop", { type, userId });
    return false;
  }
  try {
    // `Date.now()` is ms; we store ms-precision because jsonwebtoken's `iat`
    // is seconds. The comparison in isRevoked() normalizes both sides.
    await redisClient.set(cutoffKey(type, userId), String(Date.now()), "EX", CUTOFF_TTL_SECONDS);
    logger.info("tokenRevocation: revoked all tokens for user", { type, userId });
    return true;
  } catch (err) {
    logger.error("tokenRevocation: revoke failed", {
      type,
      userId,
      err: (err as Error).message,
    });
    return false;
  }
};

/**
 * Returns true when the given token (identified by user + issued-at) has
 * been revoked. Fail-open: if Redis is unreachable, returns false (a token
 * passes verification). The trade-off is intentional — having every API
 * request hard-fail when Redis blips would be worse than briefly accepting
 * tokens that should have been revoked.
 *
 * `iat` is the token's issued-at claim (seconds since epoch).
 */
export const isRevoked = async (
  type: UserType,
  userId: string,
  iat: number | undefined
): Promise<boolean> => {
  if (!isRedisReady() || typeof iat !== "number") return false;
  try {
    const raw = await redisClient.get(cutoffKey(type, userId));
    if (!raw) return false;
    const cutoffMs = Number(raw);
    if (!Number.isFinite(cutoffMs)) return false;
    // iat is in seconds; multiply to compare against ms-precision cutoff.
    return iat * 1000 < cutoffMs;
  } catch (err) {
    logger.warn("tokenRevocation: isRevoked check failed; failing open", {
      type,
      userId,
      err: (err as Error).message,
    });
    return false;
  }
};

/**
 * Clear the cutoff for a user. Useful in tests; not exposed via HTTP.
 */
export const clearRevocationCutoff = async (
  type: UserType,
  userId: string
): Promise<void> => {
  if (!isRedisReady()) return;
  try {
    await redisClient.del(cutoffKey(type, userId));
  } catch (err) {
    logger.warn("tokenRevocation: clear failed", {
      type,
      userId,
      err: (err as Error).message,
    });
  }
};
