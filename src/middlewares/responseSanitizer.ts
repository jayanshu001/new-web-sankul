// src/middlewares/responseSanitizer.ts
//
// The last net before an internal error string reaches a user.
//
// `errorHandler.ts` only sees errors that are THROWN. It never sees the ~540
// hand-written sites across ~78 controllers that catch and answer directly:
//
//   } catch (error: any) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
//
// During a deploy those `error.message`s are Prisma/driver strings, and they go
// straight to the app and the admin dashboard untouched. Rewriting 540 call
// sites is neither reviewable nor future-proof — a new controller written next
// month would leak again. Patching the ONE function they all funnel through is.
//
// WHAT IT DOES: for responses with status >= 500 only, replace `message` with
// the generic sentence when it looks internal (see utils/errorSanitizer.ts) and
// drop debug-only keys. 2xx/3xx/4xx bodies are passed through byte-for-byte —
// this must never touch a successful payload or a validation error.
//
// `res.send(object)` delegates to `res.json` inside Express, so patching `json`
// covers both. The app-level `json replacer` (IST dates) still applies because
// we call through to the original implementation.
//
// MOUNT ORDER: before the routes, so the patch is installed on `res` by the time
// any handler answers. It is a no-op for every non-5xx response.

import type { RequestHandler } from "express";
import logger from "../utils/logger";
import { sanitizeClientMessage } from "../utils/errorSanitizer";

/** Keys that are useful in a log and never in a response body. */
const DEBUG_ONLY_KEYS = ["stack", "errorObject", "detail", "details", "cause"];

export const responseSanitizer: RequestHandler = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = function sanitizedJson(body?: unknown) {
    // Only 5xx, only plain objects. Arrays and primitives are left alone.
    if (
      res.statusCode < 500 ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return originalJson(body as never);
    }

    try {
      const source = body as Record<string, unknown>;
      const rawMessage = source["message"];
      const safeMessage = sanitizeClientMessage(rawMessage, res.statusCode);

      const leakedKeys = DEBUG_ONLY_KEYS.filter((key) => key in source);
      const messageChanged = safeMessage !== rawMessage;

      if (!messageChanged && leakedKeys.length === 0) {
        return originalJson(body as never);
      }

      // The raw text still has to reach triage — this is often the ONLY record
      // of the failure, because the controller that produced it answered
      // directly instead of throwing into errorHandler (which logs).
      logger.error("Sanitized internal error out of a 5xx response", {
        traceId: (req as { traceId?: string }).traceId,
        statusCode: res.statusCode,
        method: req.method,
        url: req.originalUrl,
        ...(messageChanged ? { rawMessage: String(rawMessage ?? "") } : {}),
        ...(leakedKeys.length ? { strippedKeys: leakedKeys } : {}),
      });

      // Shallow copy: never mutate an object the caller may still hold.
      const sanitized: Record<string, unknown> = { ...source };
      if (messageChanged) sanitized["message"] = safeMessage;
      for (const key of leakedKeys) delete sanitized[key];

      return originalJson(sanitized as never);
    } catch {
      // A sanitiser that throws would turn a 500 into a dropped connection.
      // Falling through to the original body is the safe failure mode.
      return originalJson(body as never);
    }
  } as typeof res.json;

  next();
};

export default responseSanitizer;
