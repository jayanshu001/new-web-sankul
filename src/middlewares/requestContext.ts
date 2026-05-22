// src/middlewares/requestContext.ts
//
// Opens an AsyncLocalStorage scope for the duration of the request so any
// code path can read/update the per-request context via utils/requestContext.
//
// Mount order matters: this must run AFTER requestLogger (which sets
// req.traceId) and BEFORE any auth / metrics / route handlers — so by the
// time controllers run, the context already carries the traceId.

import type { RequestHandler } from "express";
import { runWithContext, updateContext } from "../utils/requestContext";

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  // Seed with traceId only; userId is filled in by authenticate. route is
  // filled in at request-end (we can't know it before routing happens).
  runWithContext({ traceId: (req as any).traceId }, () => {
    // After routing, Express populates req.route — capture the template at
    // 'finish' so the request-end log line and metrics see the normalized
    // path (e.g. `/courses/:id`, not `/courses/507f...`).
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
