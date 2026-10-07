// Rate limiting: Redis-backed per-surface limiters, keyed by user or IP.
import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redisClient } from "./redis";
import logger from "../utils/logger";
import { verifyAccessToken } from "../utils/jwtSigner";

// Kill-switch for load/QA testing: turns every limiter into a pass-through.
// Never set in production.
const RATE_LIMIT_DISABLED =
  String(process.env.RATE_LIMIT_DISABLED).toLowerCase() === "true";

const noopLimiter: RequestHandler = (_req, _res, next) => next();

const gate = (limiter: RequestHandler): RequestHandler =>
  RATE_LIMIT_DISABLED ? noopLimiter : limiter;

if (RATE_LIMIT_DISABLED) {
  logger.warn(
    "RATE_LIMIT_DISABLED=true — ALL rate limiters are OFF (testing mode). Do not use in production."
  );
}

// Always build the Redis store: it does not connect at construction, and gating
// on Redis readiness at import time would silently fall back to per-process
// memory counters (one per PM2 worker) whenever Redis was still connecting.
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

// Public /share/* pages: unauthenticated and hit by link-preview bots on every
// forwarded message. Generous but bounded, keyed by IP.
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

// Client surface: burst-friendly (screens fire 6-8 parallel calls). Keyed by
// customer id when a valid Bearer is present so NAT users don't share a bucket;
// IP for pre-login traffic.
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

export const otpLimiter = gate(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this IP, please try again after 15 minutes.",
  },
  store: redisStore("rl:otp:"),
}));

// Keyed per admin so a chatty session can't crowd out an IP-shared bucket.
// Mount AFTER `authenticate` so `req.user.id` is available.
export const adminLimiter = gate(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as any).user?.id;
    // ipKeyGenerator normalises IPv6 to /64 so rotating within a subnet can't
    // bypass the limit (required by express-rate-limit v7).
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
