// src/middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";
import { sendEmail } from "../utils/emailService";
import logger from "../utils/logger";
import { scrub } from "../utils/scrub";
import { redisClient, isRedisReady } from "../config/redis";

/** Shape of errors you throw from your code */
export interface AppError extends Error {
  statusCode?: number;
  errorObject?: unknown;
}

/** Optional: a convenience error class for your routes/services */
export class HttpError extends Error implements AppError {
  statusCode: number;
  errorObject?: unknown;

  constructor(statusCode: number, message: string, errorObject?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.errorObject = errorObject;
    // Maintains proper stack trace in Node
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}

// Prevent email floods — max one notification per unique error message per minute.
// Backed by Redis so the cooldown is shared across pods. With the old
// in-memory Map, every pod would send its own email per minute, so a 5-pod
// deployment emitted 5x the alert volume for the same recurring error. The
// `SET ... NX EX 60` is atomic — first pod wins, others get no-op.
const ERROR_EMAIL_COOLDOWN_SECONDS = 60;
const errorEmailCooldownKey = (statusCode: number, message: string) =>
  `err-email-cooldown:${statusCode}:${message}`;

/**
 * Returns true if THIS pod won the right to send the email for the given
 * error signature within the cooldown window. Fail-open: if Redis is down,
 * permits the email (better one alert per pod than none at all).
 */
const acquireEmailCooldown = async (
  statusCode: number,
  message: string
): Promise<boolean> => {
  if (!isRedisReady()) return true;
  try {
    const result = await redisClient.set(
      errorEmailCooldownKey(statusCode, message),
      String(Date.now()),
      "EX",
      ERROR_EMAIL_COOLDOWN_SECONDS,
      "NX"
    );
    return result === "OK";
  } catch {
    return true; // fail-open
  }
};

const errorHandler: ErrorRequestHandler = async (err, req, res, _next) => {
  const appErr = err as AppError;

  const statusCode = Number.isInteger(appErr.statusCode)
    ? (appErr.statusCode as number)
    : 500;

  const message = appErr.message ?? "Internal Server Error";
  const errorObject = appErr.errorObject ?? null;

  // Structured error logging
  try {
    logger.error("API Error", {
      traceId: (req as any).traceId,
      message,
      statusCode,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      stack: appErr.stack,
      // Scrubbed: error logs frequently include payload context for triage
      // (e.g. /verify-otp failures), but raw OTPs/passwords must not land in
      // the log file or the 5xx alert email.
      body: scrub(req.body),
      query: scrub(req.query),
      params: scrub(req.params),
    });
  } catch {
    // Avoid logger crashes from non‑serializable req.body etc.
  }

  // Ensure JSON response and avoid sending twice
  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      message,
    });
  }

  // Fire-and-forget email for 5xx only — debounced to 1 per unique error per
  // minute, cluster-wide via Redis SET NX EX.
  if (statusCode >= 500) {
    const shouldSend = await acquireEmailCooldown(statusCode, message);
    if (!shouldSend) return;

    const emailTo = "ranavinit6834@gmail.com";
    const subject = `Web Sankul API Error: ${statusCode}`;
    const emailBody = `
      <html>
        <body>
          <h1>Server Error Notification</h1>
          <p><strong>Message:</strong> ${escapeHtml(message)}</p>
          <p><strong>Status Code:</strong> ${statusCode}</p>
          <pre>${escapeHtml(JSON.stringify(errorObject, null, 2))}</pre>
          <pre>${escapeHtml(appErr.stack ?? "")}</pre>
        </body>
      </html>
    `;

    void sendEmail(emailTo, subject, emailBody).catch((emailError: unknown) => {
      const emailMsg =
        emailError instanceof Error ? emailError.message : String(emailError);
      logger.error("Failed to send error notification email", {
        emailError: emailMsg,
        originalError: message,
      });
    });
  }

  // Do not call next() here — you’ve already handled the error response.
};

export default errorHandler;

/** Minimal HTML escaper for safe email output */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
