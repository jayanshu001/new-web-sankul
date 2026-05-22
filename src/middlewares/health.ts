// src/middlewares/health.ts
//
// Two distinct health endpoints, exposed by app.ts:
//
//   /healthz — Liveness. "Is the Node process alive enough to be useful?"
//              Cheap, no I/O. K8s/PM2 uses this to decide whether to RESTART.
//              Returns 200 unless the process is wedged (timeouts kick in).
//
//   /readyz  — Readiness. "Should the LB send traffic here right now?"
//              Pings Mongo, Redis, and the notification queue. Returns 503
//              if any dependency is unhealthy. K8s uses this to decide
//              whether to KEEP traffic flowing; failing /readyz briefly
//              during a Mongo blip is preferable to spraying 5xx at users.
//
// Both endpoints are mounted BEFORE the global rate limiter so a scrape
// storm or LB health-check storm doesn't accidentally get throttled.

import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { redisClient } from "../config/redis";
import { isShuttingDown } from "../utils/gracefulShutdown";

const PING_TIMEOUT_MS = 1_500;

const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Liveness probe. Returns 200 with uptime + pid as long as the event loop
 * is responsive enough to serve the request. Never checks I/O.
 */
export const livenessHandler: RequestHandler = (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptimeSec: Math.floor(process.uptime()),
    pid: process.pid,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Readiness probe. Pings Mongo and Redis with a tight timeout each. Returns
 * 200 only if every check passes. Anything else → 503 + per-check status.
 *
 * Note: we don't ping the notification queue separately because it shares
 * the Redis connection backend — a healthy Redis implies the queue can
 * accept jobs. (BullMQ would need its own roundtrip to verify, and that
 * roundtrip is itself adding load that doesn't pay off in failure detection.)
 */
export const readinessHandler: RequestHandler = async (_req, res) => {
  // If a SIGTERM has been received we want the load balancer to stop sending
  // traffic immediately, even though Mongo + Redis are still healthy at this
  // instant. Returning 503 here is the cleanest way to drain.
  if (isShuttingDown()) {
    return res.status(503).json({
      status: "shutting_down",
      timestamp: new Date().toISOString(),
    });
  }

  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Mongo: rely on the existing connection's readyState + a cheap admin ping.
  // readyState alone is fine for "is the driver connected", but a primary
  // failover can leave readyState=1 while writes are silently buffering. The
  // ping forces a real roundtrip.
  const mongoStart = Date.now();
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error(`mongoose readyState=${mongoose.connection.readyState}`);
    }
    await withTimeout(
      mongoose.connection.db!.admin().ping() as unknown as Promise<unknown>,
      PING_TIMEOUT_MS,
      "mongo"
    );
    checks.mongo = { ok: true, latencyMs: Date.now() - mongoStart };
  } catch (err) {
    checks.mongo = {
      ok: false,
      latencyMs: Date.now() - mongoStart,
      error: (err as Error).message,
    };
  }

  // Redis: PING is the canonical check. ioredis short-circuits with a queued
  // error if not connected, so the timeout is belt-and-suspenders.
  const redisStart = Date.now();
  try {
    const reply = await withTimeout(redisClient.ping(), PING_TIMEOUT_MS, "redis");
    if (reply !== "PONG") throw new Error(`unexpected ping reply: ${reply}`);
    checks.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.redis = {
      ok: false,
      latencyMs: Date.now() - redisStart,
      error: (err as Error).message,
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ready" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
};
