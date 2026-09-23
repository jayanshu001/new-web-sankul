// Apple's public iTunes Lookup API — the only OFFICIAL, key-less way to read
// the currently-published App Store version of an app. There is no equivalent
// official API for Google Play, so Android's "latest" comes from admin config
// (see app-version.service.ts).
//
// Docs: https://performance-partners.apple.com/search-api
//   GET https://itunes.apple.com/lookup?bundleId=<id>&country=<cc>
//   -> { resultCount, results: [{ version, trackViewUrl, releaseNotes, ... }] }
//
// Result is cached in Redis so a burst of app opens doesn't hammer Apple and
// so a transient Apple outage still serves the last-known-good version.

import { callOutbound } from "../../libs/outbound";
import { redisClient, isRedisReady } from "../../config/redis";
import logger from "../../utils/logger";

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const TIMEOUT_MS = 4000;
const CACHE_KEY = "app-version:appstore:ios";
const CACHE_TTL_SECONDS = 60 * 30; // 30 min — store versions change rarely.

export interface AppStoreLookup {
  /** Marketing version name, e.g. "1.2.0". */
  version: string;
  /** Canonical store listing URL. */
  storeUrl: string;
  /** Release notes for the latest version, if Apple returns them. */
  releaseNotes: string | null;
}

const iosBundleId = (): string | null =>
  process.env.IOS_BUNDLE_ID?.trim() || null;

const iosAppStoreId = (): string | null =>
  process.env.IOS_APP_STORE_ID?.trim() || null;

const storeCountry = (): string =>
  process.env.APP_STORE_COUNTRY?.trim().toLowerCase() || "in";

/**
 * Fetch the live App Store version. Returns `null` (never throws) when the app
 * isn't configured, Apple is unreachable, or the app can't be found — callers
 * fall back to admin config in that case.
 */
export const fetchAppStoreVersion = async (): Promise<AppStoreLookup | null> => {
  const bundleId = iosBundleId();
  const appId = iosAppStoreId();
  if (!bundleId && !appId) {
    logger.warn("fetchAppStoreVersion skipped — IOS_BUNDLE_ID / IOS_APP_STORE_ID not set");
    return null;
  }

  // Serve from cache first.
  if (isRedisReady()) {
    try {
      const cached = await redisClient.get(CACHE_KEY);
      if (cached) return JSON.parse(cached) as AppStoreLookup;
    } catch {
      /* cache read is best-effort */
    }
  }

  const params = new URLSearchParams({ country: storeCountry() });
  if (bundleId) params.set("bundleId", bundleId);
  else if (appId) params.set("id", appId);

  try {
    const result = await callOutbound(
      async () => {
        const res = await fetch(`${ITUNES_LOOKUP_URL}?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`iTunes lookup failed with status ${res.status}.`);
        }
        const data = (await res.json()) as {
          resultCount: number;
          results: Array<{
            version?: string;
            trackViewUrl?: string;
            releaseNotes?: string;
          }>;
        };
        const app = data.results?.[0];
        if (!app?.version) return null;
        const lookup: AppStoreLookup = {
          version: app.version,
          storeUrl: app.trackViewUrl ?? "",
          releaseNotes: app.releaseNotes ?? null,
        };
        return lookup;
      },
      { label: "itunes.lookup", timeoutMs: TIMEOUT_MS, attempts: 2 }
    );

    if (result && isRedisReady()) {
      try {
        await redisClient.set(CACHE_KEY, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
      } catch {
        /* cache write is best-effort */
      }
    }
    return result;
  } catch (err) {
    // Apple down / circuit open / timeout — degrade gracefully to config.
    logger.warn("fetchAppStoreVersion failed — falling back to config", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};
