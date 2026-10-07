// Health checks: liveness, readiness and status-report handlers.
// /healthz = liveness (no I/O; drives restarts). /readyz = readiness (pings MySQL +
// Redis, 503 on failure; drives LB traffic). Both are mounted before the global rate
// limiter so health-check storms are never throttled.

import type { RequestHandler } from "express";
import { redisClient } from "../config/redis";
import { prisma } from "../config/prisma";
import { isShuttingDown } from "../utils/gracefulShutdown";
import { sanitizeClientMessage } from "../utils/errorSanitizer";
import {
  getPdfUploadQueueOrNull,
  getPdfUploadWorkerOrNull,
} from "../admin/pdfUpload/pdfUpload.scheduler";

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

export const livenessHandler: RequestHandler = (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptimeSec: Math.floor(process.uptime()),
    pid: process.pid,
    timestamp: new Date().toISOString(),
  });
};

/**
 * 200 only if every check passes, else 503 + per-check status. The notification queue
 * isn't pinged separately: it shares Redis, so a healthy Redis implies it can accept jobs.
 */
export const readinessHandler: RequestHandler = async (_req, res) => {
  // After SIGTERM, 503 so the load balancer drains this instance even while dependencies are healthy.
  if (isShuttingDown()) {
    return res.status(503).json({
      status: "shutting_down",
      timestamp: new Date().toISOString(),
    });
  }

  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  const mysqlStart = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, PING_TIMEOUT_MS, "mysql");
    checks.mysql = { ok: true, latencyMs: Date.now() - mysqlStart };
  } catch (err) {
    checks.mysql = {
      ok: false,
      latencyMs: Date.now() - mysqlStart,
      error: sanitizeClientMessage((err as Error).message, 500),
    };
  }

  const redisStart = Date.now();
  try {
    const reply = await withTimeout(redisClient.ping(), PING_TIMEOUT_MS, "redis");
    if (reply !== "PONG") throw new Error(`unexpected ping reply: ${reply}`);
    checks.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.redis = {
      ok: false,
      latencyMs: Date.now() - redisStart,
      error: sanitizeClientMessage((err as Error).message, 500),
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ready" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Public status snapshot for uptime monitors (Redis, PDF-upload queue counts, worker
 * state). Always 200: a degraded dependency shows in the body, not the status. Exposes
 * only connection booleans and queue depths.
 */
export const healthReportHandler: RequestHandler = async (_req, res) => {
  let redis: "connected" | "disconnected" = "disconnected";
  try {
    const reply = await withTimeout(redisClient.ping(), PING_TIMEOUT_MS, "redis");
    redis = reply === "PONG" ? "connected" : "disconnected";
  } catch {
    redis = "disconnected";
  }

  const queue = getPdfUploadQueueOrNull();
  let workerPdfEmailQueue: "connected" | "disconnected" = "disconnected";
  let counts: Record<string, number> = {};
  if (queue) {
    try {
      counts = await withTimeout(queue.getJobCounts(), PING_TIMEOUT_MS, "queueCounts");
      workerPdfEmailQueue = "connected";
    } catch {
      workerPdfEmailQueue = "disconnected";
    }
  }

  const worker = getPdfUploadWorkerOrNull();
  const workerPdfEmailWorker = worker?.isRunning() ? "running" : "stopped";

  res.status(200).json({
    service: "web-sankul-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: { redis },
    messageQueue: {
      workerPdfEmailQueue,
      counts,
    },
    otherWorkers: {
      workerPdfEmailWorker,
    },
  });
};
