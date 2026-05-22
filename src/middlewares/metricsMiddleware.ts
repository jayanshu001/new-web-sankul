// src/middlewares/metricsMiddleware.ts
//
// Records RED metrics (Rate / Errors / Duration) per HTTP route. Mounted
// once in app.ts. Uses `res.on("finish")` so we capture the final status
// code and we don't double-count on connection aborts.

import { RequestHandler } from "express";
import {
  httpRequestsTotal,
  httpRequestDurationMs,
  normalizeRoute,
} from "../utils/metrics";

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    // Skip the metrics endpoint itself — Prometheus scraping shouldn't be in
    // its own RPS counter (it'd dwarf real traffic).
    if (req.path === "/metrics") return;

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const labels = {
      method: req.method,
      route: normalizeRoute(req),
      status: res.statusCode,
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationMs.observe(elapsedMs, labels);
  });
  next();
};
