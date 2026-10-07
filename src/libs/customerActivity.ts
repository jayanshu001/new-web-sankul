// src/libs/customerActivity.ts
//
// Records that a customer used the app today, per platform — one row per customer per
// IST day per platform in ws_customer_activity_day
// (DDL: docs/migration/schema-changes/2026-10-07_customer_activity_day.sql).
// Feeds the admin dashboard's "Active customers" tile.
import type { Request } from "express";
import { prisma } from "../config/prisma";
import { redisClient } from "../config/redis";
import logger from "../utils/logger";

export type Platform = "android" | "ios" | "web";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
// Outlives the IST day it marks, whatever hour it was set.
const MARK_TTL_SECONDS = 26 * 60 * 60;
// While the table is missing (DDL not applied yet), stop trying for this long.
const MISSING_TABLE_BACKOFF_MS = 10 * 60 * 1000;
const PLATFORMS: Platform[] = ["android", "ios", "web"];

let skipUntil = 0;

/** IST calendar day as YYYY-MM-DD — the dashboard buckets days in IST. */
export const istDay = (d: Date = new Date()) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Which client sent the request, as far as the request itself can tell; null for a
 * native-app request that doesn't say (resolved from the customer's os_type instead).
 */
const platformOf = (req: Request): Platform | null => {
  const explicit = String(req.headers["x-platform"] ?? "").toLowerCase();
  if ((PLATFORMS as string[]).includes(explicit)) return explicit as Platform;
  // Browsers send Origin on cross-site calls; native apps don't (app.ts's CORS rule relies on the same split).
  if (req.headers.origin) return "web";
  const ua = String(req.headers["user-agent"] ?? "");
  if (/okhttp|android/i.test(ua)) return "android";
  if (/cfnetwork|darwin|iphone|ipad|\bios\b/i.test(ua)) return "ios";
  return null;
};

/**
 * Fire-and-forget: never awaited, never throws, never slows the request.
 * A Redis NX mark makes it one INSERT per customer per day per platform; INSERT IGNORE
 * on the (day, customer_id, platform) primary key covers a Redis miss or a race.
 */
export const markCustomerActive = (customerId: string | number, req: Request): void => {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0 || Date.now() < skipUntil) return;
  const day = istDay();
  const platform = platformOf(req);

  void (async () => {
    try {
      const fresh = await redisClient.set(`customer_active:${day}:${id}:${platform ?? "app"}`, "1", "EX", MARK_TTL_SECONDS, "NX");
      if (fresh !== "OK") return;
    } catch {
      // Redis unreachable — fall through; the primary key still dedupes.
    }
    try {
      // An app request that didn't identify itself takes the customer's os_type (android|ios).
      await prisma.$executeRaw`
        INSERT IGNORE INTO ws_customer_activity_day (day, customer_id, platform)
        SELECT ${day}, id, COALESCE(${platform}, os_type, 'android') FROM ws_customer WHERE id = ${id}`;
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (/ws_customer_activity_day/.test(message) && /doesn't exist|1146/.test(message)) {
        skipUntil = Date.now() + MISSING_TABLE_BACKOFF_MS;
        logger.warn("[customerActivity] ws_customer_activity_day missing — apply 2026-10-07_customer_activity_day.sql; retrying in 10 min");
        return;
      }
      logger.debug("[customerActivity] mark failed", { customerId: id, error: message });
    }
  })();
};
