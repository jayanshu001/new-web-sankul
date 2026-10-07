// Response sanitizer: strips internal error text and debug keys from 5xx JSON bodies.
// Last net before an internal error string reaches a user. errorHandler only sees
// thrown errors; hundreds of controllers catch and answer `res.status(500).json({
// message: error.message })` directly, leaking Prisma/driver text. Patching res.json
// covers them all, including future ones.
//
// For status >= 500 only: replace an internal-looking `message` with the generic one
// (utils/errorSanitizer.ts) and drop debug-only keys. Non-5xx bodies pass through
// byte-for-byte. `res.send(object)` delegates to `res.json`, so both are covered, and the
// app-level json replacer (IST dates) still applies. Mount before the routes.

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

      // Often the only record of the failure: the controller answered directly
      // instead of throwing into errorHandler (which logs).
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
      // A throwing sanitiser would turn a 500 into a dropped connection; fall through.
      return originalJson(body as never);
    }
  } as typeof res.json;

  next();
};

export default responseSanitizer;
