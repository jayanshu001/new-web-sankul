import crypto from "crypto";
import logger from "./logger";
import type { RequestHandler } from 'express';

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
  };

  logger.info("API Request Start", requestMetadata);

  const startHighRes = process.hrtime.bigint();
  let completed = false;

  res.on("finish", () => {
    completed = true;
    const durationMs = Number(process.hrtime.bigint() - startHighRes) / 1_000_000;

    logger.info("API Request Completed", {
      ...requestMetadata,
      statusCode: res.statusCode,
      responseTime: `${durationMs.toFixed(2)}ms`,
      body: req.method !== "GET" ? req.body : undefined,
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

