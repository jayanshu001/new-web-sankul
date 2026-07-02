import type { RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redisClient } from "./redis";
import logger from "../utils/logger";

// Temporary kill-switch for load / QA testing. Set RATE_LIMIT_DISABLED=true in
// .env to turn EVERY limiter into a no-op pass-through (no counting, no 429s).
// Leave unset / "false" in production — this weakens anti-DDoS / anti-spam.
const RATE_LIMIT_DISABLED =
  String(process.env.RATE_LIMIT_DISABLED).toLowerCase() === "true";

// Pass-through middleware used when limiting is disabled.
const noopLimiter: RequestHandler = (_req, _res, next) => next();

// Wrap a constructed limiter so the disable flag short-circuits it. Keeping the
// real limiter built (but unused) means flipping the flag back needs no restart-
// order gymnastics — just remove the env var and redeploy/restart.
const gate = (limiter: RequestHandler): RequestHandler =>
  RATE_LIMIT_DISABLED ? noopLimiter : limiter;

if (RATE_LIMIT_DISABLED) {
  logger.warn(
    "RATE_LIMIT_DISABLED=true — ALL rate limiters are OFF (testing mode). Do not use in production."
  );
}

// Always construct the Redis-backed store. `RedisStore` only holds a `sendCommand`
// callback and does NOT connect at construction, so the previous `isRedisReady()`
// gate was a boot-time race: if Redis was still `connecting` during module import,
// the limiter silently fell back to per-process memory for the whole process
// lifetime (each PM2 worker / node getting its own counter, weakening the limit).
// Building it unconditionally keeps every limiter cluster-wide and consistent.
const redisStore = (prefix?: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
    ...(prefix ? { prefix } : {}),
  });

// Global API rate limiter (Anti-DDOS) — 60 req/min per IP
export const globalLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  store: redisStore(),
}));

// OTP generation specific strict rate limit (Anti-Spam)
export const otpLimiter = gate(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this IP, please try again after 15 minutes.",
  },
  store: redisStore("rl:otp:"),
}));

// Admin surface limiter — keys by admin user id when authenticated, else IP.
// Tighter than the global 60/min and keyed per-admin so a chatty session can't
// crowd out the IP-shared global bucket. Mount AFTER `authenticate` on the
// admin master router so `req.user.id` is available.
export const adminLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 240, // 4x the global per-IP budget, but keyed per-admin
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as any).user?.id;
    // ipKeyGenerator normalises IPv6 to /64 so a user can't rotate within
    // their subnet to bypass the limit. Required by express-rate-limit v7.
    return uid ? `admin:${uid}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: {
    success: false,
    message: "Too many admin requests, please slow down.",
  },
  store: redisStore("rl:admin:"),
}));

// Tight limiter for write-sensitive mutations (referral credit, plan default flips,
// any admin endpoint that fans out side effects). Mount on the specific router(s).
export const adminMutationLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as any).user?.id;
    return uid ? `adminmut:${uid}` : `ipmut:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: {
    success: false,
    message: "Mutation rate exceeded; retry shortly.",
  },
  store: redisStore("rl:adminmut:"),
}));
