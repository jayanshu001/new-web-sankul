import Redis from "ioredis";
import logger from "../utils/logger";

const isDev = process.env.ENV === "DEV";
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy: (times) => {
    // Reconnect after 2 seconds
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redisClient.on("connect", () => {
  if (isDev) logger.info(`Redis Connected`);
});

redisClient.on("error", (err) => {
  if (isDev) logger.error(`Redis Error: ${err.message}`);
});

export const isRedisReady = () => redisClient.status === "ready";
