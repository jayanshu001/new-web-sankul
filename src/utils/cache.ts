import { redisClient, isRedisReady } from "../config/redis";

export const getCache = async (key: string): Promise<any | null> => {
  if (!isRedisReady()) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`[Redis] getCache Error:`, err);
    return null;
  }
};

export const setCache = async (
  key: string,
  value: any,
  ttlSeconds: number = 3600
): Promise<void> => {
  if (!isRedisReady()) return;
  try {
    await redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error(`[Redis] setCache Error:`, err);
  }
};

export const delCache = async (key: string): Promise<void> => {
  if (!isRedisReady()) return;
  try {
    await redisClient.del(key);
  } catch (err) {
    console.error(`[Redis] delCache Error:`, err);
  }
};

export const delCacheByPattern = async (pattern: string): Promise<void> => {
  if (!isRedisReady()) return;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (err) {
    console.error(`[Redis] delCacheByPattern Error:`, err);
  }
};
