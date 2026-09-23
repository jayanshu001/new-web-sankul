import crypto from "crypto";
import logger from "./logger";
import { scrub } from "./scrub";
import { getContext } from "./requestContext";
import type { RequestHandler } from 'express';

const hasKeys = (o: unknown): boolean =>
  !!o && typeof o === "object" && Object.keys(o).length > 0;

/** error for 5xx, warn for 4xx, info otherwise — so console color reflects
 * the actual outcome instead of every request logging as "info". */
const levelForStatus = (status: number): "error" | "warn" | "info" =>
  status >= 500 ? "error" : status >= 400 ? "warn" : "info";

// Extend Request to store tracing metadata in request lifecycle
declare module "express-serve-static-core" {
  interface Request {
    traceId?: string;
  }
}

const requestLogger: RequestHandler = (req, res, next) => {
  const incomingTraceId =
    typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : typeof req.headers["x-trace-id"] === "string"
      ? req.headers["x-trace-id"]
      : undefined;

  const traceId = (incomingTraceId as string) || crypto.randomUUID();
  req.traceId = traceId;
  res.setHeader("X-Request-Id", traceId);

  const requestMetadata = {
    traceId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    // Scrubbed (see utils/scrub.ts) so a phone number in an OTP flow or a
    // token passed as a query param never lands in logs. Omitted when empty
    // so a plain GET with no filters doesn't add console noise.
    params: hasKeys(req.params) ? scrub(req.params) : undefined,
    query: hasKeys(req.query) ? scrub(req.query) : undefined,
  };

  logger.info("API Request Start", requestMetadata);

  const startHighRes = process.hrtime.bigint();
  let completed = false;

  res.on("finish", () => {
    completed = true;
    const durationMs = Number(process.hrtime.bigint() - startHighRes) / 1_000_000;

    // Surface accumulated per-request telemetry from the AsyncLocalStorage
    // context: dbMs (total Mongo time), cacheHit/cacheMiss counters. The
    // logger format auto-merges userId/route/traceId so we don't repeat
    // them here. See utils/requestContext.ts for what the context carries.
    const ctx = getContext();
    logger[levelForStatus(res.statusCode)]("API Request Completed", {
      ...requestMetadata,
      statusCode: res.statusCode,
      responseTime: `${durationMs.toFixed(2)}ms`,
      durationMs: Number(durationMs.toFixed(2)),
      dbMs: ctx ? Number(ctx.dbMs.toFixed(2)) : undefined,
      cacheHit: ctx?.cacheHit,
      cacheMiss: ctx?.cacheMiss,
      // Body is scrubbed before logging so passwords, OTPs, tokens, and
      // bank/card identifiers never reach disk. See utils/scrub.ts.
      body: req.method !== "GET" && hasKeys(req.body) ? scrub(req.body) : undefined,
    });
  });

  res.on("close", () => {
    if (completed) return; // skip normal completion path, only log true aborts

    const durationMs = Number(process.hrtime.bigint() - startHighRes) / 1_000_000;
    logger.warn("API Request Aborted", {
      ...requestMetadata,
      statusCode: res.statusCode,
      responseTime: `${durationMs.toFixed(2)}ms`,
    });
  });

  next();
};

export default requestLogger;

