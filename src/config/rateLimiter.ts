import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redisClient } from "./redis";
import logger from "../utils/logger";
import { verifyAccessToken } from "../utils/jwtSigner";

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

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Best-effort user id from Bearer JWT for rate-limit keying (no session/Redis checks). */
const bearerUserId = (req: Request): string | null => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const decoded = verifyAccessToken<{ id?: string }>(token);
    return decoded?.id ?? null;
  } catch {
    return null;
  }
};

const userOrIpKey = (req: Request, namespace: string): string => {
  const uid = bearerUserId(req);
  return uid ? `${namespace}:user:${uid}` : `${namespace}:ip:${ipKeyGenerator(req.ip ?? "")}`;
};

// Educator / promoter surfaces — moderate per-IP budget (no SPA burst pattern).
export const globalLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: parsePositiveInt(process.env.RATE_LIMIT_GLOBAL_MAX, 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  store: redisStore("rl:global:"),
}));

// Public share / deep-link pages (/share/*). Unauthenticated and the most
// crawler-exposed surface we have — link-preview bots fan out on every message
// a user forwards. Generous (these are real taps) but bounded; keyed by IP
// since there is no user on this path.
export const shareLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: parsePositiveInt(process.env.RATE_LIMIT_SHARE_MAX, 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  store: redisStore("rl:share:"),
}));

// Client surface (mobile + student web) — burst-friendly for screens that fire
// 6–8 parallel API calls. Keys by customer id when a valid Bearer token is
// present so NAT/shared-IP users don't share one bucket; falls back to IP for
// pre-login traffic (OTP has its own strict limiter on /auth/otp/*).
export const clientLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: parsePositiveInt(process.env.RATE_LIMIT_CLIENT_MAX, 300),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => userOrIpKey(req, "client"),
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  store: redisStore("rl:client:"),
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
