import axios from "axios";
import { COURIER } from "../../config/courier";
import { redisClient, isRedisReady } from "../../config/redis";
import logger from "../../utils/logger";

// Live AWB status lookup against the Tirupati courier API (Point 4 of
// book-order-courier-tracking.md). Two steps: fetch a token (Redis-cached 3h),
// then query AWB data with that token + trackingId. Mahavir has no API, so live
// status only works for trackingIds in the Tirupati range.
// Mirrors websankul-api libs/utils.js (same URLs, 10s/15s timeouts, 3h cache).

const TOKEN_CACHE_KEY = "courier_token_tirupati";
const TOKEN_TTL_SECONDS = 10800; // 3 hours, matching the old backend.

// The courier answers HTTP 200 for everything: a bad UID/PWD comes back as the
// plain text "UNAUTHORIZED ACCESS" from the token URL, and a bad token as
// `OpStatus: "FAILED: UN-AUTHORIZED ACCESS.."` from the AWB URL.
const isUnauthorized = (v: unknown) => /UN-?AUTHORI[SZ]ED/i.test(String(v ?? ""));

// Fetch (and cache) the courier auth token. Cached in Redis under
// `courier_token_tirupati` for 3h so we don't re-authenticate on every request.
// Falls back to a live fetch when Redis is unavailable (graceful degradation —
// the doc calls out the Redis dependency as a caution). Only a real token is
// cached — a rejection is thrown, never stored for 3h.
export async function getTrackingUserTokenForCourier(): Promise<any> {
  if (isRedisReady()) {
    try {
      const cached = await redisClient.get(TOKEN_CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (err: any) {
      logger.warn("courier token cache read failed", { error: err?.message });
    }
  }

  const resp = await axios.get(COURIER.TIRUPATI.GET_TOKEN_URL, { timeout: 10000 });
  const token = resp?.data;
  if (!token || typeof token !== "string" || isUnauthorized(token)) {
    throw new Error("Courier token request rejected (check TIRUPATI_GET_TOKEN_URL credentials)");
  }

  if (isRedisReady()) {
    try {
      await redisClient.set(
        TOKEN_CACHE_KEY,
        JSON.stringify(token),
        "EX",
        TOKEN_TTL_SECONDS
      );
    } catch (err: any) {
      logger.warn("courier token cache write failed", { error: err?.message });
    }
  }
  return token;
}

// Fetch live AWB data for a given trackingId using a previously-obtained token.
export async function getTrackingAWBDataForCourier(params: {
  userToken: any;
  trackingId: number | string;
}): Promise<any> {
  const { userToken, trackingId } = params;
  const url = `${COURIER.TIRUPATI.AWB_DATA_URL}?Token=${userToken}&AWBNo=${trackingId}`;
  const resp = await axios.get(url, { timeout: 15000 });
  return resp?.data;
}

// Convenience: token + AWB data in one call. A cached token the courier no
// longer accepts is evicted and re-fetched once; any remaining `FAILED`
// OpStatus throws so callers answer 502 (FE falls back to the WebView) instead
// of a 200 with an empty timeline.
export async function fetchLiveAWBData(
  trackingId: number | string
): Promise<any> {
  let data = await getTrackingAWBDataForCourier({
    userToken: await getTrackingUserTokenForCourier(),
    trackingId,
  });
  if (isUnauthorized(data?.OpStatus)) {
    if (isRedisReady()) await redisClient.del(TOKEN_CACHE_KEY).catch(() => undefined);
    data = await getTrackingAWBDataForCourier({
      userToken: await getTrackingUserTokenForCourier(),
      trackingId,
    });
  }
  if (typeof data?.OpStatus === "string" && data.OpStatus.startsWith("FAILED")) {
    throw new Error(`Courier AWB lookup failed: ${data.OpStatus}`);
  }
  return { ...data, ...deriveDeliveryStatus(data) };
}

// Courier "DD-MM-YYYY" + "hh:mm AM" (IST) → Date; null when unparseable.
function parseCourierDateTime(date?: string, time?: string): Date | null {
  const d = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(date ?? "").trim());
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(time ?? "").trim());
  let h = t ? Number(t[1]) % 12 : 0;
  if (t && t[3].toUpperCase() === "PM") h += 12;
  const iso = `${d[3]}-${d[2]}-${d[1]}T${String(h).padStart(2, "0")}:${t ? t[2] : "00"}:00+05:30`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

const DELIVERED_RE = /(?<!UN|NOT )DELIVERED/i;

// Normalised status on top of the raw courier payload. `CurStatus` is the LAST
// scan, not the delivery state — the courier often logs an "In-Scan Reach At"
// after the DRS delivery (e.g. AWB 119401175732), so delivery is read from the
// scan events first.
export function deriveDeliveryStatus(data: any): {
  deliveryStatus: "delivered" | "in_transit" | "booked" | "awaiting_pickup";
  deliveredAt: Date | null;
} {
  const events: any[] = Array.isArray(data?.TrackData) ? data.TrackData : [];
  const drs = events.find((e) => DELIVERED_RE.test(String(e?.Description ?? "")));
  if (drs) return { deliveryStatus: "delivered", deliveredAt: parseCourierDateTime(drs.OpDate, drs.OpTime) };
  const cur = /DELIVERED ON (\d{2}-\d{2}-\d{4})/i.exec(String(data?.CurStatus ?? ""));
  if (cur && DELIVERED_RE.test(data.CurStatus)) {
    return { deliveryStatus: "delivered", deliveredAt: parseCourierDateTime(cur[1]) };
  }
  if (events.length) return { deliveryStatus: "in_transit", deliveredAt: null };
  if (data?.AWBDate) return { deliveryStatus: "booked", deliveredAt: null };
  return { deliveryStatus: "awaiting_pickup", deliveredAt: null };
}
