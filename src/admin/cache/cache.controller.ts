// Admin cache: manual flush and stats for the route-level response cache.
// Lets the admin panel force a refresh after editing content (middlewares/cacheRoute.ts).

import type { Request, Response } from "express";
import { redisClient, isRedisReady } from "../../config/redis";
import { ROUTE_CACHE_PREFIX } from "../../middlewares/cacheRoute";
import { success, failure } from "../../utils/httpResponse";
import logger from "../../utils/logger";

/** SCAN + delete every key matching a prefix. Non-blocking (SCAN, not KEYS). */
const deleteByPrefix = async (prefix: string): Promise<number> => {
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
 * POST /api/v1/admin/cache/flush  { prefix? }
 * No prefix flushes all route caches (`{env}:route:{ver}:*`); a prefix such as
 * "GET:/api/v1/admin/ebook" is appended to the route-cache prefix to narrow it.
 */
export const flushCache = async (req: Request, res: Response) => {
  try {
    if (!isRedisReady()) {
      return success(res, { deletedKeys: 0, note: "cache disabled/unavailable" });
    }
    const raw = (req.body?.prefix ?? req.query?.prefix) as string | undefined;
    const target = raw
      ? `${ROUTE_CACHE_PREFIX}:${raw.replace(/^:+/, "")}`
      : ROUTE_CACHE_PREFIX;

    const deletedKeys = await deleteByPrefix(target);
    logger.info(`[cache/flush] deleted ${deletedKeys} keys for "${target}"`);
    return success(res, { deletedKeys, prefix: target });
  } catch (err) {
    logger.error(`[cache/flush] ${(err as Error).stack}`);
    return failure(res, "Cache flush failed", 500);
  }
};

/**
 * GET /api/v1/admin/cache/stats
 * Counts route-cache keys (optionally under a prefix) without returning values.
 */
export const cacheStats = async (req: Request, res: Response) => {
  try {
    if (!isRedisReady()) {
      return success(res, { total: 0, note: "cache disabled/unavailable" });
    }
    const raw = (req.query?.prefix as string | undefined) ?? "";
    const target = raw
      ? `${ROUTE_CACHE_PREFIX}:${raw.replace(/^:+/, "")}`
      : ROUTE_CACHE_PREFIX;

    let cursor = "0";
    let total = 0;
    const sample: string[] = [];
    do {
      const [next, batch] = await redisClient.scan(
        cursor,
        "MATCH",
        `${target}*`,
        "COUNT",
        200
      );
      cursor = next;
      total += batch.length;
      for (const k of batch) if (sample.length < 50) sample.push(k);
    } while (cursor !== "0");

    return success(res, { total, prefix: target, sampleKeys: sample });
  } catch (err) {
    logger.error(`[cache/stats] ${(err as Error).stack}`);
    return failure(res, "Cache stats failed", 500);
  }
};
