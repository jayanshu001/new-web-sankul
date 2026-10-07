// Outbound calls (HTTP, SMS, email, payment APIs): per-attempt timeout
// (default 5s), retry with backoff + jitter on network/5xx/429 only (other 4xx is
// a bug, not transient), and a circuit breaker that short-circuits a downed
// dependency for a cooldown window.

import logger from "../utils/logger";
import { redisClient, isRedisReady } from "../config/redis";

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

export interface RetryOptions {
  attempts?: number; // total attempts including the first. Default 3.
  baseDelayMs?: number; // Default 200.
  maxDelayMs?: number; // Default 4000.
  /** Defaults to retrying network errors, 5xx and 429. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

const defaultShouldRetry = (err: unknown): boolean => {
  if (!err) return false;
  const e = err as any;
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
  const status = e?.response?.status ?? e?.status;
  if (typeof status === "number") {
    return status >= 500 || status === 429;
  }
  return false;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

// Breaker state is one Redis hash per label so a trip on any pod applies to every
// pod. When Redis is unavailable it falls back to a per-pod in-memory Map.
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
      // No MULTI needed: cross-pod overcounting only opens the breaker slightly
      // early, which is the safe direction.
      await redisClient.hset(breakerKey(label), {
        state: stats.state,
        consecutiveFailures: stats.consecutiveFailures,
        openedAt: stats.openedAt,
      });
      // 10 minutes of inactivity implicitly closes the breaker.
      await redisClient.expire(breakerKey(label), 600);
      return;
    } catch {
      // fall through to local
    }
  }
  localBreakers.set(label, { ...stats });
};

export interface CallOptions extends RetryOptions, BreakerOptions {
  /** Used for logs, breaker state and timeout error messages. */
  label: string;
  /** Per-attempt timeout. Default 5000. */
  timeoutMs?: number;
  noRetry?: boolean;
  /** Disable the circuit breaker (still respects timeout). */
  noBreaker?: boolean;
}

/**
 * Wrap an outbound call with timeout → retry with backoff and jitter → circuit breaker.
 * e.g. `callOutbound(() => axios.post(url, body), { label: "sms.2factor", timeoutMs: 4000 })`
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

  if (!noBreaker) {
    if (breaker.state === "open") {
      if (Date.now() - breaker.openedAt >= cooldownMs) {
        // Cooldown elapsed: half-open lets one probe call through.
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

      // Exponential backoff with full jitter.
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const wait = Math.floor(Math.random() * exp);
      await sleep(wait);
    }
  }

  // Unreachable; satisfies the compiler.
  throw lastErr;
};
