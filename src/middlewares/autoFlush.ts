// Route-cache invalidation for write routes: on a 2xx response (after "finish", so it
// never delays the client) it clears every cached read tagged with the entity. Fail-open
// on Redis errors. Matches by entity tag only, so cross-entity embeds (e.g. a package
// type name inside cached package details) need autoFlushGroup, TTL or /admin/cache/flush.

import type { Request, Response, NextFunction } from "express";
import { redisClient, isRedisReady } from "../config/redis";
import { entityCachePrefix, ROUTE_CACHE_PREFIX } from "./cacheRoute";
import { resolveFlushGroup, type CacheEntity } from "./flushGroups";
import cache from "../libs/cache";
import logger from "../utils/logger";

const CACHE_DEBUG = process.env.CACHE_DEBUG === "true";

const sweepEntity = async (entity: CacheEntity): Promise<number> => {
  const prefix = `${entityCachePrefix(entity)}:`;
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, batch] = await redisClient.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      200
    );
    cursor = next;
    if (batch.length) deleted += await redisClient.del(...batch);
  } while (cursor !== "0");
  // Also clear the lower-level `cache.aside` namespace (libs/cache.ts) so a write
  // route never has to know which layer cached what.
  deleted += await cache.invalidateEntity(entity);
  return deleted;
};

/**
 * Clears all cached reads for the entities, for writes that don't go through an
 * `autoFlush` route (jobs, webhooks, sockets, other services). Fail-open; returns keys
 * cleared (0 if the cache is unavailable).
 */
export const flushEntity = async (...entities: CacheEntity[]): Promise<number> => {
  if (!isRedisReady()) return 0;
  try {
    const counts = await Promise.all(entities.map(sweepEntity));
    const total = counts.reduce((a, b) => a + b, 0);
    if (CACHE_DEBUG) {
      logger.info(`[routecache] flushEntity ${entities.join(",")} → cleared ${total} keys`);
    }
    return total;
  } catch (err) {
    logger.warn("flushEntity sweep failed", {
      entities,
      err: (err as Error).message,
    });
    return 0;
  }
};

/**
 * Clears one user's cached per-user reads across every entity, leaving other users and
 * shared caches alone. Call after an entitlement change so `isPurchased` refreshes.
 * SCANs by the `...:{userId}:{role}:{hash}` key suffix (cacheRoute.buildKey). Await it so
 * the buyer's next fetch right after payment is a miss, not a stale hit. Fail-open.
 */
export const flushUserRouteCache = async (
  userId: number | string,
  role: string = "customer"
): Promise<number> => {
  if (!isRedisReady()) return 0;
  const idSegment = `${userId}:${role}`;
  const pattern = `${ROUTE_CACHE_PREFIX}:*:${idSegment}:*`;
  let cursor = "0";
  let deleted = 0;
  try {
    do {
      const [next, batch] = await redisClient.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (batch.length) deleted += await redisClient.del(...batch);
    } while (cursor !== "0");
    if (CACHE_DEBUG) {
      logger.info(`[routecache] flushUserRouteCache ${idSegment} → cleared ${deleted} keys`);
    }
    return deleted;
  } catch (err) {
    logger.warn("flushUserRouteCache sweep failed", { userId, role, err: (err as Error).message });
    return 0;
  }
};

export const autoFlush = (...entities: CacheEntity[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD") return next();

    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      void flushEntity(...entities);
    });

    return next();
  };
};

/**
 * `autoFlush` over a flush group (flushGroups.ts), so one admin write also clears every
 * client cache that embeds its data. Prefer this on admin write routes.
 */
export const autoFlushGroup = (...groups: CacheEntity[]) => {
  const entities = [...new Set(groups.flatMap(resolveFlushGroup))];
  return autoFlush(...entities);
};

export default autoFlush;
