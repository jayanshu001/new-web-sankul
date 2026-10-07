// Token revocation: Redis-backed revoke-by-cutoff with one per-user cutoff
// timestamp instead of per-token `jti`s. Any token with `iat * 1000 < cutoff`
// is revoked. Works with every JWT ever signed (`iat` is standard), costs one
// Redis GET per authenticate, and revokes ALL of a user's tokens at once
// ("log out all devices"). Single-device revocation uses the session keys.

import { redisClient, isRedisReady } from "../config/redis";
import logger from "../utils/logger";

export type UserType = "customer" | "admin" | "educator" | "promoter";

// Longest refresh-token TTL (customer: 60d), so the cutoff never expires while a
// refresh token that pre-dates it is still alive.
const CUTOFF_TTL_SECONDS = 60 * 24 * 60 * 60;

const cutoffKey = (type: UserType, userId: string): string =>
  `revoke:${type}:${userId}`;

/**
 * Revoke every token issued for this user before now. Fail-open: returns false
 * when Redis is unreachable; the DB-side session pointer flip remains the
 * primary defense.
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
    // Stored in ms; isRevoked() scales the seconds-precision `iat` to compare.
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
 * True when a token with this `iat` (seconds since epoch) has been revoked.
 * Fail-open on Redis errors by design: failing every request on a Redis blip is
 * worse than briefly accepting a revoked token.
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

/** Test helper; not exposed via HTTP. */
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
