// Redis cache: cache-aside helper. Keys are `{env}:{domain}:{entity}:{id}:{version}`; bump
// the version when a cached response shape changes. TTLs are jittered to avoid
// thundering-herd expiry, parallel misses are deduped with a `SET NX PX` lock,
// and every Redis error falls through to the loader (fail-open: the cache is
// never load-bearing for correctness).

import { redisClient, isRedisReady } from "../config/redis";
import logger from "../utils/logger";
import { cacheHitsTotal, cacheMissesTotal } from "../utils/metrics";
import { incrementContext } from "../utils/requestContext";
import { istJsonReplacer } from "../utils/istJson";
import { CacheEntity } from "../middlewares/flushGroups";
import crypto from "crypto";

const ENV = (process.env.NODE_ENV || "dev").toLowerCase();
const KEY_VERSION = process.env.CACHE_KEY_VERSION || "v1";

/** Domain segment of a cache-aside key (the caller surface). */
export enum CacheDomain {
  Admin = "admin",
  Client = "client",
  Auth = "auth",
  Permission = "permission",
  Shared = "shared",
}

const ALL_DOMAINS = Object.values(CacheDomain);

export const key = (
  domain: CacheDomain,
  entity: CacheEntity,
  id: string,
  version: string = KEY_VERSION
): string => `${ENV}:${domain}:${entity}:${id}:${version}`;

/**
 * Key prefix (no version suffix) for `invalidateByPrefix`. `key()` always
 * appends `:{version}`, so it cannot build a prefix that matches real keys.
 */
export const keyPrefix = (
  domain: CacheDomain,
  entity: CacheEntity,
  idPrefix: string
): string => `${ENV}:${domain}:${entity}:${idPrefix}`;

/** Stable short key suffix so list queries with different filters get distinct slots. */
export const hashFilter = (filter: unknown): string =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(filter ?? {}))
    .digest("hex")
    .slice(0, 12);

const jitter = (ttl: number): number => {
  // ±10%, minimum 1s
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
 * Cache-aside read: cached value if present, else `load()` and store it with a
 * jittered TTL. Parallel misses contend for `{key}:lock`; the winner loads,
 * losers poll for up to `lockMaxWaitMs` then load themselves, which avoids both
 * a stampede and a deadlock if the winner dies.
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
      // Best-effort release; the lock also has a PX expiry.
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
  // Not written back; the winner does that.
  return load();
};

const writeBack = async <T>(k: string, value: T, ttlSeconds: number) => {
  try {
    // Same IST replacer as app.ts/cacheRoute.ts: cached DTOs embed Dates, and a
    // bare stringify would freeze them as UTC strings, so a hit would render
    // dates differently from a miss.
    await redisClient.set(k, JSON.stringify(value, istJsonReplacer), "EX", jitter(ttlSeconds));
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

/** Invalidate by prefix using non-blocking SCAN. Prefer explicit keys where possible. */
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

/**
 * Sweep every `cache.aside` entry for one entity across all domains.
 * `autoFlushGroup`/`flushEntity` call this alongside the route-cache sweep, so
 * one flush clears both cache layers.
 */
export const invalidateEntity = async (entity: CacheEntity): Promise<number> => {
  const counts = await Promise.all(
    ALL_DOMAINS.map((domain) => invalidateByPrefix(keyPrefix(domain, entity, "")))
  );
  return counts.reduce((a, b) => a + b, 0);
};

export default {
  key,
  keyPrefix,
  hashFilter,
  aside,
  invalidate,
  invalidateByPrefix,
  invalidateEntity,
};
