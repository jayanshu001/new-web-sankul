// src/libs/cache.ts
//
// Centralized cache-aside helper with:
//   - Key convention: `{env}:{domain}:{entity}:{id}:{version}`
//   - TTL + jitter to prevent thundering-herd expiry
//   - Singleflight via `SET NX PX` to dedupe parallel misses on hot keys
//   - Explicit invalidation by entity/id or by pattern prefix (scan-based)
//   - Fail-open: every Redis error falls through to the loader; cache is
//     never load-bearing for correctness.
//
// Usage:
//   const goals = await cache.aside({
//     key: cache.key("admin", "goals", "list"),
//     ttlSeconds: 600,
//     load: () => Goal.find().lean(),
//   });
//
//   await cache.invalidate(cache.key("admin", "goals", "list"));
//
// Key convention (`{env}:{domain}:{entity}:{id}:{version}`):
//   env     -> NODE_ENV (or "dev")
//   domain  -> "admin" | "client" | "auth" | "permission" | ...
//   entity  -> "course" | "package" | "ebook" | "goal" | ...
//   id      -> entity id or "list" / "active" / `{filterHash}`
//   version -> short integer; bump when response shape changes

import { redisClient, isRedisReady } from "../config/redis";
import logger from "../utils/logger";
import { cacheHitsTotal, cacheMissesTotal } from "../utils/metrics";
import { incrementContext } from "../utils/requestContext";
import crypto from "crypto";

const ENV = (process.env.NODE_ENV || "dev").toLowerCase();
const KEY_VERSION = process.env.CACHE_KEY_VERSION || "v1";

export type Domain =
  | "admin"
  | "client"
  | "auth"
  | "permission"
  | "shared";

export const key = (
  domain: Domain,
  entity: string,
  id: string,
  version: string = KEY_VERSION
): string => `${ENV}:${domain}:${entity}:${id}:${version}`;

/**
 * Hash a filter object into a stable short key suffix so list queries with
 * different filters get distinct cache slots.
 */
export const hashFilter = (filter: unknown): string =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(filter ?? {}))
    .digest("hex")
    .slice(0, 12);

const jitter = (ttl: number): number => {
  // ±10% jitter, minimum 1s
  const delta = Math.max(1, Math.round(ttl * 0.1));
  return ttl + Math.floor(Math.random() * (delta * 2)) - delta;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AsideOptions<T> {
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
  /** When true (default), uses SET NX PX singleflight lock around the miss. */
  singleflight?: boolean;
  /** Max lock wait before falling back to direct load. Default 1500ms. */
  lockMaxWaitMs?: number;
}

/**
 * Cache-aside read. Returns cached value if present, else calls `load()`,
 * stores result with jittered TTL, and returns it.
 *
 * Singleflight: parallel misses on the same key contend for a Redis lock
 * (`{key}:lock` via SET NX PX). The winner runs `load()`. Losers poll the
 * value key for up to `lockMaxWaitMs`, then fall back to `load()` themselves
 * if still missing (avoids stampede AND avoids deadlock if the winner dies).
 */
export const aside = async <T>(opts: AsideOptions<T>): Promise<T> => {
  const { key: k, ttlSeconds, load } = opts;
  const useLock = opts.singleflight !== false;
  const lockMaxWaitMs = opts.lockMaxWaitMs ?? 1500;

  // `{env}:{domain}:{entity}:...` — domain is the 2nd segment.
  const domain = k.split(":")[1] || "unknown";

  if (!isRedisReady()) {
    cacheMissesTotal.inc({ domain });
    incrementContext("cacheMiss");
    return load();
  }

  try {
    const hit = await redisClient.get(k);
    if (hit) {
      cacheHitsTotal.inc({ domain });
      incrementContext("cacheHit");
      return JSON.parse(hit) as T;
    }
  } catch (err) {
    logger.warn("cache.aside read failed; bypassing cache", {
      key: k,
      err: (err as Error).message,
    });
    cacheMissesTotal.inc({ domain });
    incrementContext("cacheMiss");
    return load();
  }
  cacheMissesTotal.inc({ domain });
  incrementContext("cacheMiss");

  if (!useLock) {
    const value = await load();
    void writeBack(k, value, ttlSeconds);
    return value;
  }

  const lockKey = `${k}:lock`;
  const lockToken = crypto.randomBytes(8).toString("hex");
  let acquired = false;
  try {
    const ok = await redisClient.set(lockKey, lockToken, "PX", 5000, "NX");
    acquired = ok === "OK";
  } catch (err) {
    logger.warn("cache.aside lock acquire failed; loading directly", {
      key: k,
      err: (err as Error).message,
    });
    return load();
  }

  if (acquired) {
    try {
      const value = await load();
      await writeBack(k, value, ttlSeconds);
      return value;
    } finally {
      // Best-effort lock release; correctness doesn't depend on it because
      // the lock has a PX expiry.
      try {
        const current = await redisClient.get(lockKey);
        if (current === lockToken) await redisClient.del(lockKey);
      } catch {
        /* swallow */
      }
    }
  }

  // Lost the lock race: poll the value briefly.
  const pollIntervalMs = 50;
  const start = Date.now();
  while (Date.now() - start < lockMaxWaitMs) {
    await sleep(pollIntervalMs);
    try {
      const hit = await redisClient.get(k);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      break;
    }
  }
  // Fallback: load directly. Won't write back to cache (winner will).
  return load();
};

const writeBack = async <T>(k: string, value: T, ttlSeconds: number) => {
  try {
    await redisClient.set(k, JSON.stringify(value), "EX", jitter(ttlSeconds));
  } catch (err) {
    logger.warn("cache.aside write-back failed", {
      key: k,
      err: (err as Error).message,
    });
  }
};

/** Delete one or more exact keys. Fail-open. */
export const invalidate = async (...keys: string[]): Promise<void> => {
  if (!keys.length || !isRedisReady()) return;
  try {
    await redisClient.del(...keys);
  } catch (err) {
    logger.warn("cache.invalidate failed", {
      keys,
      err: (err as Error).message,
    });
  }
};

/**
 * Invalidate by prefix using non-blocking SCAN. Use sparingly — prefer
 * tracking explicit keys when you write them.
 */
export const invalidateByPrefix = async (prefix: string): Promise<number> => {
  if (!isRedisReady()) return 0;
  let cursor = "0";
  let deleted = 0;
  try {
    do {
      const [nextCursor, batch] = await redisClient.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        200
      );
      cursor = nextCursor;
      if (batch.length) {
        const n = await redisClient.del(...batch);
        deleted += n;
      }
    } while (cursor !== "0");
  } catch (err) {
    logger.warn("cache.invalidateByPrefix failed", {
      prefix,
      err: (err as Error).message,
    });
  }
  return deleted;
};

export default {
  key,
  hashFilter,
  aside,
  invalidate,
  invalidateByPrefix,
};
