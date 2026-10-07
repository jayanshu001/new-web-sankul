// Request context: opens a per-request AsyncLocalStorage scope (read via utils/requestContext).
// Must run after requestLogger (sets req.traceId) and before auth/metrics/routes.

import type { RequestHandler } from "express";
import { runWithContext, updateContext } from "../utils/requestContext";

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  // userId is filled in by authenticate; route at request end, once routing has happened.
  runWithContext({ traceId: (req as any).traceId }, () => {
    // Capture the route template so logs/metrics see `/courses/:id`, not the raw id.
    res.on("finish", () => {
      const tpl = (req as any).route?.path;
      if (tpl) {
        const base = req.baseUrl || "";
        updateContext({ route: `${base}${tpl}` });
      }
    });
    next();
  });
};
