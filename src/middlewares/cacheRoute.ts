// Route-level response cache for read routes (no controller changes). Freshness comes
// from TTL plus `autoFlush` on write routes (or `POST /admin/cache/flush`). Keys include
// the user id + role by default so no user is ever served another's response; public
// reads opt into `CacheScope.Shared`. Only 2xx JSON GETs are stored, deflated + base64.
// Fail-open: any Redis error falls through to the handler.

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

export enum CacheScope {
  /** Key includes req.user id+role — safe default for auth-gated data. */
  User = "user",
  /** Key by URL only — only for responses identical for all callers. Never user-specific data. */
  Shared = "shared",
}

export interface CacheRouteOptions {
  /** Seconds. */
  ttl: number;
  /** Defaults to CacheScope.User. */
  scope?: CacheScope;
  /**
   * The tag `autoFlush(entity)` sweeps; keep it consistent across a resource's read and
   * write routes. Omitted = CacheEntity.Misc (cacheable but not entity-flushable).
   */
  entity?: CacheEntity;
}

/** Prefix for all cached reads of one entity — the unit `autoFlush` clears. */
export const entityCachePrefix = (entity: CacheEntity): string =>
  `${ROUTE_CACHE_PREFIX}:${entity}`;

const jitter = (ttl: number): number => {
  const delta = Math.max(1, Math.round(ttl * 0.1));
  // Spread by the current second so bulk-warmed keys don't share an exact expiry.
  const spread = Math.floor(Date.now() / 1000) % (delta * 2 + 1);
  return ttl - delta + spread;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stampede control: how long a losing request polls before running the handler itself
// (bounded so a dead winner can't hang it).
const LOCK_MAX_WAIT_MS = 1500;
const LOCK_POLL_MS = 50;
const LOCK_TTL_MS = 5000;

/** Null on miss. A corrupt or old-format entry is a miss and is evicted, never served. */
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

/** Sorted params with blanks dropped, so equivalent queries share one key (prevents key explosion). */
const normalizeQuery = (req: Request): string => {
  const q = req.query as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(q).sort()) {
    const v = q[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${k}=${Array.isArray(v) ? v.join(",") : String(v)}`);
  }
  return parts.join("&");
};

/** Unless shared, the key includes the caller's identity so responses never leak across users. */
const buildKey = (
  req: Request,
  scope: CacheScope,
  entity: CacheEntity
): string => {
  const user = (req as any).user;
  const identity =
    scope === CacheScope.Shared
      ? "shared"
      : req.isGuest
        ? "guest:none" // every guest gets the same not-purchased view
        : `${user?.id ?? "anon"}:${user?.role ?? "none"}`;
  const query = normalizeQuery(req);
  const raw = `${req.method}:${req.baseUrl}${req.path}?${query}:${identity}`;
  const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
  const pathPart = req.baseUrl + req.path;
  return `${entityCachePrefix(entity)}:${req.method}:${pathPart}:${identity}:${hash}`;
};

export const cacheRoute = (opts: number | CacheRouteOptions) => {
  const parsed: CacheRouteOptions =
    typeof opts === "number" ? { ttl: opts, scope: CacheScope.User } : opts;
  const { ttl, scope = CacheScope.User } = parsed;
  const entity: CacheEntity = parsed.entity ?? CacheEntity.Misc;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    if (!isRedisReady()) return next();

    const user = (req as any).user;

    // No user on a user-scoped route means cacheRoute ran before authenticate; caching
    // under "anon:none" would leak this response to the next caller.
    if (scope === CacheScope.User && !user && !req.isGuest) {
      logger.warn(
        "cacheRoute: user-scoped route has no req.user — skipping cache (ensure cacheRoute runs AFTER authenticate)",
        { url: req.originalUrl }
      );
      return next();
    }

    // A mis-tagged shared route would leak per-user data; flag it in debug.
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
      // Media tokens live ~5 min but entries up to 24h, so re-mint them for the caller
      // (the body was just parsed, so mutating it is safe). Resolve still re-checks
      // entitlement live.
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

    try {
      const hit = await readHit(key);
      if (hit) return serveHit(hit);
    } catch (err) {
      logger.warn("cacheRoute read failed; bypassing", {
        key,
        err: (err as Error).message,
      });
      return next();
    }

    cacheMissesTotal.inc({ domain });
    incrementContext("cacheMiss");
    if (CACHE_DEBUG) logger.info(`[routecache] MISS ${req.method} ${req.originalUrl}`);

    // Stampede control: try to become the single loader for this key.
    let isLoader = true;
    try {
      const ok = await redisClient.set(lockKey, "1", "PX", LOCK_TTL_MS, "NX");
      isLoader = ok === "OK";
    } catch {
      isLoader = true;
    }

    if (!isLoader) {
      // Another request is loading: poll briefly to serve its result instead of hitting
      // the DB too. Bounded (plus the lock's PX expiry) in case the loader dies.
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
      // Load directly without write-back so the loser doesn't fight the winner's write.
      return next();
    }

    const releaseLock = () => {
      redisClient.del(lockKey).catch(() => {
        /* lock has a PX expiry; best-effort release */
      });
    };
    const originalJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Fire-and-forget. This JSON.stringify bypasses Express's "json replacer", so it
        // must apply istJsonReplacer itself or hits would serve UTC dates and misses IST.
        deflate(Buffer.from(JSON.stringify({ status: res.statusCode, body }, istJsonReplacer), "utf8"))
          .then((compressed) =>
            // Per-user bodies carry day-granular fields (daysLeft); never outlive the IST day.
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
