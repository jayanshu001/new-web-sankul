// RED metrics (rate/errors/duration) per route. `res.on("finish")` captures the
// final status code and avoids double-counting on connection aborts.

import { RequestHandler } from "express";
import {
  httpRequestsTotal,
  httpRequestDurationMs,
  normalizeRoute,
} from "../utils/metrics";

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    // Exclude the scrape endpoint so Prometheus polling doesn't dwarf real traffic.
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
