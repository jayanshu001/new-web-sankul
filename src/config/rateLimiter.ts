import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redisClient, isRedisReady } from "./redis";

// Global API rate limiter (Anti-DDOS)
export const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  // Use Redis store if ready, otherwise fallback to in-memory
  store: isRedisReady()
    ? new RedisStore({
        sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
      })
    : undefined,
});

// OTP generation specific strict rate limit (Anti-Spam)
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this IP, please try again after 15 minutes.",
  },
  store: isRedisReady()
    ? new RedisStore({
        sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
        prefix: "rl:otp:",
      })
    : undefined,
});
