// src/libs/outbound.ts
//
// Wrappers around outbound calls (third-party HTTP, SMS, email, payment APIs).
// Centralizes the three things every outbound call needs:
//
//   1. A timeout. Network calls without timeouts pin event-loop slots until
//      the OS gives up, which is minutes. We default to 5s.
//   2. Retries with exponential backoff + jitter. Retry only on retryable
//      errors (network, 5xx, 429). 4xx other than 429 is a bug, not a
//      transient failure — no retry.
//   3. A circuit breaker. After N consecutive failures the breaker opens
//      and short-circuits subsequent calls for a cooldown window. Stops
//      us from hammering a downed dependency and lets it recover.
//
// All three pieces are intentionally tiny — no opossum / async-retry deps.
// If you need fancier semantics (half-open, bulkheads, fallbacks) consider
// pulling in `opossum`.

import logger from "../utils/logger";
import { redisClient, isRedisReady } from "../config/redis";

// ──────────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────────

export class OutboundTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "OutboundTimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor(label: string) {
    super(`Circuit open for ${label} — request short-circuited.`);
    this.name = "CircuitOpenError";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Timeout
// ──────────────────────────────────────────────────────────────────────────────

const withTimeout = async <T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  return Promise.race([
    fn(),
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new OutboundTimeoutError(label, ms)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// Retry
// ──────────────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts?: number; // total attempts including the first. Default 3.
  baseDelayMs?: number; // initial backoff. Default 200.
  maxDelayMs?: number; // cap on the backoff. Default 4000.
  /** Custom predicate; defaults to "retry on network errors, 5xx, 429". */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

const defaultShouldRetry = (err: unknown): boolean => {
  if (!err) return false;
  const e = err as any;
  // Network errors expose .code on Node's HTTP errors.
  if (
    e.code === "ECONNRESET" ||
    e.code === "ETIMEDOUT" ||
    e.code === "ENOTFOUND" ||
    e.code === "ECONNREFUSED" ||
    e.code === "EAI_AGAIN" ||
    e.name === "OutboundTimeoutError"
  ) {
    return true;
  }
  // HTTP responses surfaced as errors by Axios / Got.
  const status = e?.response?.status ?? e?.status;
  if (typeof status === "number") {
    return status >= 500 || status === 429;
  }
  return false;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ──────────────────────────────────────────────────────────────────────────────
// Circuit breaker
// ──────────────────────────────────────────────────────────────────────────────

export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. Default 5. */
  failureThreshold?: number;
  /** Cooldown (ms) before the breaker tries a probe call. Default 30_000. */
  cooldownMs?: number;
}

type BreakerState = "closed" | "open" | "half-open";

interface BreakerStats {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number; // 0 when closed
}

// Breaker state lives in Redis so all pods see the same view. Previously each
// pod kept its own in-memory Map, which defeated the whole point: if pod A
// observed a Razorpay outage and opened its breaker, pods B/C/D would happily
// keep hammering Razorpay and stall the load balancer. With Redis-backed
// state, the first pod to see the threshold-th failure trips the breaker for
// every pod.
//
// We use a single Redis HASH per label: { state, consecutiveFailures, openedAt }.
// Reads + writes are 1 ROUNDTRIP each. On Redis unavailability we fall back to
// a local in-memory Map — the fallback is per-pod, so it behaves like the
// old code (degraded but functional). isRedisReady() flips back the moment
// Redis recovers.
const localBreakers = new Map<string, BreakerStats>();

const breakerKey = (label: string) => `breaker:${label}`;

const readBreaker = async (label: string): Promise<BreakerStats> => {
  if (isRedisReady()) {
    try {
      const raw = await redisClient.hgetall(breakerKey(label));
      if (raw && raw.state) {
        return {
          state: raw.state as BreakerState,
          consecutiveFailures: Number(raw.consecutiveFailures) || 0,
          openedAt: Number(raw.openedAt) || 0,
        };
      }
      // No entry yet — closed by default.
      return { state: "closed", consecutiveFailures: 0, openedAt: 0 };
    } catch {
      // fall through to local
    }
  }
  let b = localBreakers.get(label);
  if (!b) {
    b = { state: "closed", consecutiveFailures: 0, openedAt: 0 };
    localBreakers.set(label, b);
  }
  return b;
};

const writeBreaker = async (label: string, stats: BreakerStats): Promise<void> => {
  if (isRedisReady()) {
    try {
      // HSET is atomic per-field; that's enough because each callOutbound
      // invocation reads then writes the breaker once. We don't need MULTI
      // because consecutive-failure overcounting at a 5-second granularity
      // is harmless (worst case: breaker opens one attempt earlier across
      // pods, which is the safe direction).
      await redisClient.hset(breakerKey(label), {
        state: stats.state,
        consecutiveFailures: stats.consecutiveFailures,
        openedAt: stats.openedAt,
      });
      // Bound the key's lifetime. After 10 minutes of no activity the
      // breaker is implicitly closed (auto-recovery).
      await redisClient.expire(breakerKey(label), 600);
      return;
    } catch {
      // fall through to local
    }
  }
  localBreakers.set(label, { ...stats });
};

/** Read-only snapshot of every breaker known to THIS pod's local fallback
 *  cache. For accurate cluster-wide state, query Redis directly. */
export const breakerSnapshot = (): Record<string, BreakerStats> => {
  const out: Record<string, BreakerStats> = {};
  for (const [k, v] of localBreakers.entries()) out[k] = { ...v };
  return out;
};

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface CallOptions extends RetryOptions, BreakerOptions {
  /** Identifier used for logs, breaker state, and timeout error messages. */
  label: string;
  /** Per-attempt timeout. Default 5000. */
  timeoutMs?: number;
  /** Disable retry (single attempt). */
  noRetry?: boolean;
  /** Disable the circuit breaker (still respects timeout). */
  noBreaker?: boolean;
}

/**
 * Wrap an async function (typically an HTTP/SMS/email call) with:
 *   timeout → retry-with-backoff-and-jitter → circuit breaker.
 *
 * Usage:
 *   const sms = await callOutbound(
 *     () => axios.post(SMS_URL, { phone, otp }),
 *     { label: "sms.2factor", timeoutMs: 4000, attempts: 3 }
 *   );
 */
export const callOutbound = async <T>(
  fn: () => Promise<T>,
  opts: CallOptions
): Promise<T> => {
  const {
    label,
    timeoutMs = 5_000,
    attempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 4_000,
    shouldRetry = defaultShouldRetry,
    failureThreshold = 5,
    cooldownMs = 30_000,
    noRetry = false,
    noBreaker = false,
  } = opts;

  const breaker = noBreaker
    ? { state: "closed" as BreakerState, consecutiveFailures: 0, openedAt: 0 }
    : await readBreaker(label);

  // Breaker gate ──────────────────────────────────────────────────────────────
  if (!noBreaker) {
    if (breaker.state === "open") {
      if (Date.now() - breaker.openedAt >= cooldownMs) {
        // Cooldown elapsed — move to half-open and let ONE probe call through.
        breaker.state = "half-open";
        await writeBreaker(label, breaker);
      } else {
        throw new CircuitOpenError(label);
      }
    }
  }

  const totalAttempts = noRetry ? 1 : attempts;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const result = await withTimeout(fn, timeoutMs, label);

      // Success path — reset breaker if it had any failure state attached.
      if (!noBreaker && (breaker.state !== "closed" || breaker.consecutiveFailures > 0)) {
        await writeBreaker(label, {
          state: "closed",
          consecutiveFailures: 0,
          openedAt: 0,
        });
      }
      return result;
    } catch (err) {
      lastErr = err;
      logger.warn("outbound call failed", {
        label,
        attempt,
        totalAttempts,
        err: (err as Error)?.message,
      });

      // Breaker accounting ─────────────────────────────────────────────────
      if (!noBreaker) {
        breaker.consecutiveFailures += 1;
        if (
          breaker.state === "half-open" ||
          breaker.consecutiveFailures >= failureThreshold
        ) {
          breaker.state = "open";
          breaker.openedAt = Date.now();
          logger.error("circuit breaker opened", {
            label,
            consecutiveFailures: breaker.consecutiveFailures,
            cooldownMs,
          });
        }
        await writeBreaker(label, breaker);
      }

      const isLastAttempt = attempt === totalAttempts;
      if (isLastAttempt || !shouldRetry(err, attempt)) {
        throw err;
      }

      // Exponential backoff with full jitter (AWS-style).
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const wait = Math.floor(Math.random() * exp);
      await sleep(wait);
    }
  }

  // Unreachable, but TypeScript wants it.
  throw lastErr;
};
