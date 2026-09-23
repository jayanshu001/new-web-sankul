import axios from "axios";
import { COURIER } from "../../config/courier";
import { redisClient, isRedisReady } from "../../config/redis";
import logger from "../../utils/logger";

// Live AWB status lookup against the Tirupati courier API (Point 4 of
// book-order-courier-tracking.md). Two steps: fetch a token (Redis-cached 3h),
// then query AWB data with that token + trackingId. Mahavir has no API, so live
// status only works for trackingIds in the Tirupati range.

const TOKEN_CACHE_KEY = "courier_token_tirupati";
const TOKEN_TTL_SECONDS = 10800; // 3 hours, matching the old backend.

// Fetch (and cache) the courier auth token. Cached in Redis under
// `courier_token_tirupati` for 3h so we don't re-authenticate on every request.
// Falls back to a live fetch when Redis is unavailable (graceful degradation —
// the doc calls out the Redis dependency as a caution).
export async function getTrackingUserTokenForCourier(): Promise<any> {
  if (isRedisReady()) {
    try {
      const cached = await redisClient.get(TOKEN_CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (err: any) {
      logger.warn("courier token cache read failed", { error: err?.message });
    }
  }

  const resp = await axios.get(COURIER.TIRUPATI.GET_TOKEN_URL);
  const token = resp?.data;

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
  const resp = await axios.get(url);
  return resp?.data;
}

// Convenience: token + AWB data in one call.
export async function fetchLiveAWBData(
  trackingId: number | string
): Promise<any> {
  const userToken = await getTrackingUserTokenForCourier();
  return getTrackingAWBDataForCourier({ userToken, trackingId });
}
