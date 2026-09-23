// src/middlewares/cacheRoute.ts
//
// Route-level response cache — caches the serialized HTTP response for a read
// route, with ZERO changes to controllers or services. This is the single place
// all read-caching lives; opt a route in by adding `cacheRoute(ttl)` to it (or
// listing it in `CACHED_ROUTES`).
//
//   router.get("/admin/ebook/:id", cacheRoute(600), getEbookById);
//
// Design decisions (deliberate):
//   - TTL-only freshness. There is NO automatic write→invalidate hook. Cached
//     responses expire on their TTL; to force-refresh sooner, call the admin
//     flush endpoint (`POST /admin/cache/flush`). This is the tradeoff for not
//     touching service code — see cache/ROUTE_CACHE.md.
//   - Per-user keys by default. The cache key includes the authenticated user
//     id + role, so one user can NEVER be served another user's cached response.
//     Shared/public reads can opt into a URL-only key with `{ scope: CacheScope.Shared }`.
//   - Only GET is cached, only 2xx JSON responses are stored.
//   - Fail-open. Any Redis error falls through to the real handler; the cache is
//     never load-bearing for correctness.
//   - Deflate-compressed at rest. Bodies are stored zlib-deflated + base64 in
//     Redis (not compressed over the wire to the client — that's the separate
//     `compression()` middleware in app.ts). A corrupt/undecodable entry is
//     treated as a miss and evicted rather than served or thrown.
//
// It reuses the low-level primitives in libs/cache.ts (same Redis client,
// jitter, fail-open, metrics) rather than a second cache stack.

import type { Request, Response, NextFunction } from "express";
import zlib from "zlib";
import { promisify } from "util";
import { redisClient, isRedisReady } from "../config/redis";
import { CacheEntity } from "./flushGroups";
import logger from "../utils/logger";
import { cacheHitsTotal, cacheMissesTotal } from "../utils/metrics";
import { incrementContext } from "../utils/requestContext";
import { refreshMediaTokensInPlace } from "../utils/mediaToken";
import { istJsonReplacer, secondsToIstMidnight } from "../utils/istJson";
import crypto from "crypto";

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

const ENV = (process.env.NODE_ENV || "dev").toLowerCase();
const KEY_VERSION = process.env.CACHE_KEY_VERSION || "v1";
const CACHE_DEBUG = process.env.CACHE_DEBUG === "true";

// Shared prefix so the flush endpoint and stats can target route caches only.
export const ROUTE_CACHE_PREFIX = `${ENV}:route:${KEY_VERSION}`;

/**
 * Who a cached response is valid for — the other half of a route's cache
 * identity alongside `CacheEntity`. A real enum (not a bare string union) so
 * every call site reuses one symbol (`CacheScope.User`) instead of retyping
 * the string.
 */
export enum CacheScope {
  /** Key includes req.user id+role — safe default for auth-gated data. */
  User = "user",
  /** Key by URL only — ONLY for responses identical for all callers (public
   * catalog, banners, faq). Never use for anything user-specific. */
  Shared = "shared",
}

export interface CacheRouteOptions {
  /** TTL in seconds. */
  ttl: number;
  /**
   * CacheScope.User (default): key includes req.user id+role — safe for
   * auth-gated data. CacheScope.Shared: key by URL only — ONLY for responses
   * identical for all callers (public catalog, banners, faq). Never use
   * Shared for anything user-specific.
   */
  scope?: CacheScope;
  /**
   * Entity tag baked into the cache key (e.g. CacheEntity.Ebook, CacheEntity.Course).
   * This is what `autoFlush(entity)` on the write routes sweeps to clear all
   * cached reads for the entity. Omit and the route is grouped under
   * CacheEntity.Misc (still cacheable, but not entity-flushable). Keep it
   * consistent across a resource's read + write routes.
   */
  entity?: CacheEntity;
}

/** Prefix for all cached reads of one entity — the unit `autoFlush` clears. */
export const entityCachePrefix = (entity: CacheEntity): string =>
  `${ROUTE_CACHE_PREFIX}:${entity}`;

const jitter = (ttl: number): number => {
  const delta = Math.max(1, Math.round(ttl * 0.1));
  // Deterministic-enough spread without Math.random (unavailable in some ctx):
  // derive from current second so bulk-warmed keys don't share an exact expiry.
  const spread = Math.floor(Date.now() / 1000) % (delta * 2 + 1);
  return ttl - delta + spread;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// #7 Stampede control: how long a losing request polls the value key before it
// gives up and runs the handler itself (bounded so a dead winner can't hang it).
const LOCK_MAX_WAIT_MS = 1500;
const LOCK_POLL_MS = 50;
const LOCK_TTL_MS = 5000;

/**
 * Try to read a cached response body for `key`. Returns the parsed
 * {status, body} or null on miss/decompress-or-parse-failure.
 *
 * Entries are stored deflate-compressed + base64-encoded (see the write path
 * below) to keep Redis memory bounded at scale — cached list/detail JSON
 * compresses 70-85%. A corrupt or pre-compression-format entry is treated as
 * a miss and deleted so it self-heals on the next write, rather than ever
 * serving garbage to a caller.
 */
const readHit = async (
  key: string
): Promise<{ status: number; body: unknown } | null> => {
  const hit = await redisClient.get(key);
  if (!hit) return null;
  try {
    const decompressed = await inflate(Buffer.from(hit, "base64"));
    return JSON.parse(decompressed.toString("utf8")) as { status: number; body: unknown };
  } catch (err) {
    logger.warn("cacheRoute: corrupt cache entry, evicting", {
      key,
      err: (err as Error).message,
    });
    redisClient.del(key).catch(() => {
      /* best-effort eviction */
    });
    return null;
  }
};

/**
 * Normalize the query string so equivalent requests collapse to ONE cache key:
 *   ?a=1&b=2  ==  ?b=2&a=1  ==  (with empty params dropped)
 * Params are sorted, blank values removed. This is the main defence against
 * cache-key explosion on filtered/paginated client lists.
 */
const normalizeQuery = (req: Request): string => {
  const q = req.query as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(q).sort()) {
    const v = q[k];
    if (v === undefined || v === null || v === "") continue;
    // Arrays (?tag=a&tag=b) → stable joined form.
    parts.push(`${k}=${Array.isArray(v) ? v.join(",") : String(v)}`);
  }
  return parts.join("&");
};

/**
 * Build the cache key for a request. Includes method, path, a NORMALIZED query
 * string, and — unless shared — the caller's identity, so responses never leak
 * across users.
 */
const buildKey = (
  req: Request,
  scope: CacheScope,
  entity: CacheEntity
): string => {
  const user = (req as any).user;
  const identity =
    scope === CacheScope.Shared
      ? "shared"
      : `${user?.id ?? "anon"}:${user?.role ?? "none"}`;
  const query = normalizeQuery(req);
  const raw = `${req.method}:${req.baseUrl}${req.path}?${query}:${identity}`;
  const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
  // Human-readable path segment + hash keeps keys greppable AND unique.
  const pathPart = req.baseUrl + req.path;
  // `{prefix}:{entity}:...` — entity is the sweep unit for autoFlush.
  return `${entityCachePrefix(entity)}:${req.method}:${pathPart}:${identity}:${hash}`;
};

/**
 * Express middleware: serve a cached JSON response if present, otherwise let the
 * handler run and cache its 2xx JSON body on the way out.
 */
export const cacheRoute = (opts: number | CacheRouteOptions) => {
  const parsed: CacheRouteOptions =
    typeof opts === "number" ? { ttl: opts, scope: CacheScope.User } : opts;
  const { ttl, scope = CacheScope.User } = parsed;
  // Untagged routes group under "misc" (cacheable but not entity-flushable).
  const entity: CacheEntity = parsed.entity ?? CacheEntity.Misc;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache idempotent reads.
    if (req.method !== "GET") return next();
    if (!isRedisReady()) return next();

    const user = (req as any).user;

    // #8 Auth-ordering safety: a "user"-scoped route with no authenticated user
    // means cacheRoute ran BEFORE authenticate (or on an unauthenticated route).
    // Caching under "anon:none" would let the next user read this response — a
    // cross-user leak. Skip caching entirely instead.
    if (scope === CacheScope.User && !user) {
      logger.warn(
        "cacheRoute: user-scoped route has no req.user — skipping cache (ensure cacheRoute runs AFTER authenticate)",
        { url: req.originalUrl }
      );
      return next();
    }

    // #5 Shared-scope guardrail: a "shared" route returns ONE response to every
    // caller. If it's serving authenticated, per-user data, that's a leak from a
    // mis-tag. We can't know intent, but surface it loudly in debug.
    if (scope === CacheScope.Shared && user && CACHE_DEBUG) {
      logger.warn(
        "cacheRoute: shared-scope route served to an authenticated user — confirm this response is identical for all users",
        { url: req.originalUrl }
      );
    }

    const key = buildKey(req, scope, entity);
    const lockKey = `${key}:lock`;
    const domain = req.baseUrl.split("/")[3] || "route"; // /api/v1/<surface> ...

    const serveHit = (h: { status: number; body: unknown }) => {
      cacheHitsTotal.inc({ domain });
      incrementContext("cacheHit");
      if (CACHE_DEBUG) logger.info(`[routecache] HIT ${req.method} ${req.originalUrl}`);
      // Media tokens live ~5 min but these entries live up to 24h, so a replayed
      // body would hand the app a token that is already expired on arrival (and
      // its refetch-and-retry would re-read this same body). Re-mint them for the
      // caller. The body was just JSON.parse'd here, so mutating it is safe.
      // Resolve still re-verifies + re-checks entitlement live for every kind.
      const custId = Number((req as any).user?.id);
      if (Number.isInteger(custId)) {
        try {
          refreshMediaTokensInPlace(h.body, custId);
        } catch (err) {
          // Never let token refresh break a cache hit — serve what we have.
          logger.warn("cacheRoute media-token refresh failed", {
            url: req.originalUrl,
            err: (err as Error).message,
          });
        }
      }
      res.status(h.status).json(h.body);
    };

    // 1. Try cache.
    try {
      const hit = await readHit(key);
      if (hit) return serveHit(hit);
    } catch (err) {
      // Read failure → bypass cache, run handler.
      logger.warn("cacheRoute read failed; bypassing", {
        key,
        err: (err as Error).message,
      });
      return next();
    }

    cacheMissesTotal.inc({ domain });
    incrementContext("cacheMiss");
    if (CACHE_DEBUG) logger.info(`[routecache] MISS ${req.method} ${req.originalUrl}`);

    // 2. #7 Stampede control. Try to become the single loader for this key.
    let isLoader = true;
    try {
      const ok = await redisClient.set(lockKey, "1", "PX", LOCK_TTL_MS, "NX");
      isLoader = ok === "OK";
    } catch {
      // Lock errors are non-fatal — just behave as the loader.
      isLoader = true;
    }

    if (!isLoader) {
      // Lost the race: another request is loading. Poll the value briefly so we
      // can serve its result instead of hitting the DB too. Bounded wait avoids
      // deadlock if the loader dies (the lock's PX expiry also covers that).
      const start = Date.now();
      while (Date.now() - start < LOCK_MAX_WAIT_MS) {
        await sleep(LOCK_POLL_MS);
        try {
          const hit = await readHit(key);
          if (hit) return serveHit(hit);
        } catch {
          break;
        }
      }
      // Still nothing → fall through and load directly (do NOT write-back;
      // the loser shouldn't fight the winner's write). Just run the handler.
      return next();
    }

    // 3. We are the loader: intercept res.json to capture + store the body,
    //    release the lock either way.
    const releaseLock = () => {
      redisClient.del(lockKey).catch(() => {
        /* lock has a PX expiry; best-effort release */
      });
    };
    const originalJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      // Only cache successful responses; never cache errors/redirects.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Fire-and-forget write-back (compressed — see readHit); never block
        // the response on it. Must apply the same IST date replacer Express's
        // own res.json() uses (app.set("json replacer", ...) in app.ts) —
        // this JSON.stringify call bypasses that, so without it every cache
        // HIT would serve raw UTC `...Z` dates while a MISS correctly serves
        // `...+05:30` — same field, different format depending on luck.
        deflate(Buffer.from(JSON.stringify({ status: res.statusCode, body }, istJsonReplacer), "utf8"))
          .then((compressed) =>
            // Per-user bodies carry day-granular fields (daysLeft) — never let
            // one outlive the IST day it was computed on.
            redisClient.set(key, compressed.toString("base64"), "EX", scope === CacheScope.User ? Math.min(jitter(ttl), secondsToIstMidnight()) : jitter(ttl))
          )
          .catch((err) =>
            logger.warn("cacheRoute write-back failed", {
              key,
              err: (err as Error).message,
            })
          );
      }
      releaseLock();
      return originalJson(body);
    };
    // If the handler never calls res.json (error/stream), release on finish.
    res.on("finish", releaseLock);

    return next();
  };
};

export default cacheRoute;
