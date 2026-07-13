// src/middlewares/autoFlush.ts
//
// Auto-invalidation for the route-level response cache. Put it on WRITE routes
// (POST/PUT/PATCH/DELETE) for an entity; when the write succeeds, it sweeps all
// cached reads for that entity so the next GET returns fresh data — with NO
// changes to controllers or services.
//
//   router.get("/",     cacheRoute({ ttl: 120, entity: "ebook" }), getEbooks);
//   router.get("/:id",  cacheRoute({ ttl: 600, entity: "ebook" }), getEbookById);
//   router.post("/",    autoFlush("ebook"), createEbook);
//   router.put("/:id",  autoFlush("ebook"), updateEbook);
//   router.delete("/:id", autoFlush("ebook"), deleteEbook);
//
// Semantics (entity-wide):
//   - On a 2xx response, clear EVERY cached read tagged with this entity
//     (all detail keys + all list variants). Broad but always-correct for
//     same-entity edits.
//   - Only flushes on success — a failed/validation-rejected write (non-2xx)
//     leaves the cache intact.
//   - Fires AFTER the response is sent (res "finish"), so it never delays the
//     client and never runs on a request that errored out before responding.
//   - Fail-open: a Redis error is logged and swallowed; the write already
//     succeeded regardless.
//
// LIMITATION (by design): this matches by entity tag, so it CANNOT clear
// cross-entity embeds. E.g. renaming a package *type* won't refresh cached
// package *details* that embed the type name — those still rely on TTL or a
// manual /admin/cache/flush. Only same-entity staleness is auto-handled.

import type { Request, Response, NextFunction } from "express";
import { redisClient, isRedisReady } from "../config/redis";
import { entityCachePrefix } from "./cacheRoute";
import { resolveFlushGroup, type CacheEntity } from "./flushGroups";
import logger from "../utils/logger";

const CACHE_DEBUG = process.env.CACHE_DEBUG === "true";

const sweepEntity = async (entity: string): Promise<number> => {
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
  return deleted;
};

/**
 * Imperatively clear all cached reads for one or more entities. Use this from
 * code paths that mutate cached data but do NOT flow through an `autoFlush`
 * route — BullMQ jobs, webhooks, socket handlers, or another module's service.
 *
 *   import { flushEntity } from "../../middlewares/autoFlush";
 *   await adminEbook.setUploadStatus(id, "completed");
 *   await flushEntity("ebook");   // keep the route cache honest
 *
 * Fail-open: a Redis error is logged and swallowed. Returns the number of keys
 * cleared (0 if cache is unavailable).
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
 * Middleware factory: invalidate all cached reads for `entity` when this write
 * succeeds. Accepts one or more entities (e.g. a write that affects both
 * "package" and "package-type").
 */
export const autoFlush = (...entities: CacheEntity[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Nothing to do for non-mutating verbs (defensive; these routes are writes).
    if (req.method === "GET" || req.method === "HEAD") return next();

    res.on("finish", () => {
      // Only invalidate when the write actually succeeded.
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      // flushEntity is fail-open and no-ops when Redis is unavailable.
      void flushEntity(...entities);
    });

    return next();
  };
};

/**
 * Like `autoFlush`, but expands a flush GROUP (from flushGroups.ts) to its full
 * entity list — so one admin write clears both its own cache AND every client
 * cache that embeds its data. Prefer this on admin write routes.
 *
 *   router.put("/:id", autoFlushGroup("ebook"), updateEbook);
 *   // → flushes ebook, catalog-ebook, client-dashboard, free, exam-countdown
 *
 * Accepts multiple groups (deduped) for writes that span concerns.
 */
export const autoFlushGroup = (...groups: CacheEntity[]) => {
  const entities = [...new Set(groups.flatMap(resolveFlushGroup))];
  return autoFlush(...entities);
};

export default autoFlush;
