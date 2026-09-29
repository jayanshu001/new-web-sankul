// src/libs/guestSession.ts
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { redisClient, isRedisReady } from "../config/redis";
import { signAccessToken, verifyAccessToken } from "../utils/jwtSigner";
import logger from "../utils/logger";

/**
 * Guest sessions — a temporary, account-less identity (no `ws_customer` row).
 *
 * A guest token is a normal access-ring JWT with `type: "guest"` and a random
 * `sid`. The session itself is ONE Redis key whose TTL is the session lifetime,
 * so expiry and cleanup need no job: ACTIVE = key exists, EXPIRED = TTL ran out,
 * CONVERTED / REVOKED = key deleted.
 *
 * ponytail: Redis-only, no `ws_guest_session` table. Guests own no data in this
 * app (every guest-reachable route is a catalog GET), so there is nothing to
 * migrate or clean up. Add a table when a guest-writable feature (e.g. a guest
 * cart) needs an owner row, or when conversion analytics must outlive the logs.
 */
const GUEST_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const sessionKey = (sid: string): string => `guest_session:${sid}`;

export const createGuestSession = async (): Promise<{ accessToken: string; expiresAt: string }> => {
  const sid = crypto.randomUUID();
  const accessToken = signAccessToken({ type: "guest", role: "guest", sid }, { expiresIn: GUEST_SESSION_TTL_SECONDS });
  // Redis down → the token is still issued; liveness fails open below.
  if (isRedisReady()) await redisClient.set(sessionKey(sid), "1", "EX", GUEST_SESSION_TTL_SECONDS);
  return { accessToken, expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_SECONDS * 1000).toISOString() };
};

/** True for a decoded payload that is a guest token. */
export const isGuestPayload = (decoded: any): boolean => decoded?.type === "guest" || decoded?.role === "guest";

/**
 * Fails OPEN when Redis is unavailable: a guest token only ever reaches public
 * catalog reads, so an outage must not lock every guest out of the app.
 */
export const isGuestSessionLive = async (sid: unknown): Promise<boolean> => {
  if (typeof sid !== "string" || !sid) return false;
  if (!isRedisReady()) return true;
  try {
    return (await redisClient.exists(sessionKey(sid))) === 1;
  } catch (err) {
    logger.warn("guestSession: liveness check failed; failing open", { err: (err as Error).message });
    return true;
  }
};

/** `sid` of a signature-valid, live guest token; null for anything else. */
export const liveGuestSid = async (token: string): Promise<string | null> => {
  // Cheap unverified peek first so customer tokens skip the verify + Redis hit.
  if (!isGuestPayload(jwt.decode(token))) return null;
  try {
    const decoded = verifyAccessToken<any>(token);
    return isGuestPayload(decoded) && (await isGuestSessionLive(decoded.sid)) ? decoded.sid : null;
  } catch {
    return null;
  }
};

/**
 * Guest → user conversion / guest logout: the old guest token stops working.
 * Best-effort — never fails the login it is attached to.
 */
export const revokeGuestSession = async (token: string | undefined, convertedToUserId?: string | number): Promise<void> => {
  if (!token) return;
  try {
    const sid = await liveGuestSid(token);
    if (!sid || !isRedisReady()) return;
    await redisClient.del(sessionKey(sid));
    logger.info("guestSession: session ended", { sid, convertedToUserId: convertedToUserId ?? null });
  } catch (err) {
    logger.warn("guestSession: revoke failed", { err: (err as Error).message });
  }
};
