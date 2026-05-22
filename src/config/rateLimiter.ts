import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redisClient, isRedisReady } from "./redis";

// Global API rate limiter (Anti-DDOS) — 60 req/min per IP
export const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
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

// Admin surface limiter — keys by admin user id when authenticated, else IP.
// Tighter than the global 60/min and keyed per-admin so a chatty session can't
// crowd out the IP-shared global bucket. Mount AFTER `authenticate` on the
// admin master router so `req.user.id` is available.
export const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 240, // 4x the global per-IP budget, but keyed per-admin
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as any).user?.id;
    return uid ? `admin:${uid}` : `ip:${req.ip}`;
  },
  message: {
    success: false,
    message: "Too many admin requests, please slow down.",
  },
  store: isRedisReady()
    ? new RedisStore({
        sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
        prefix: "rl:admin:",
      })
    : undefined,
});

// Tight limiter for write-sensitive mutations (referral credit, plan default flips,
// any admin endpoint that fans out side effects). Mount on the specific router(s).
export const adminMutationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as any).user?.id;
    return uid ? `adminmut:${uid}` : `ipmut:${req.ip}`;
  },
  message: {
    success: false,
    message: "Mutation rate exceeded; retry shortly.",
  },
  store: isRedisReady()
    ? new RedisStore({
        sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
        prefix: "rl:adminmut:",
      })
    : undefined,
});
