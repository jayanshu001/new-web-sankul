// src/middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";
import { sendEmail } from "../utils/emailService";
import logger from "../utils/logger";
import { scrub } from "../utils/scrub";
import { redisClient, isRedisReady } from "../config/redis";
import {
  isDatabaseUnavailableError,
  SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_RETRY_SECONDS,
} from "../utils/dbAvailability";
import { sanitizeClientMessage } from "../utils/errorSanitizer";

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

  // A database outage is not an application bug: answer 503 + Retry-After so
  // clients back off and retry, instead of the bare 500 ("we're broken") this
  // used to send. Only applies when the thrown error carried no explicit status
  // — an intentional `new HttpError(...)` always wins.
  //
  // It also gives the right SIGNAL for a deploy window: a Prisma connection
  // error is transient, so 503 + Retry-After tells the client to come back,
  // where 500 says "this request will never work". (The leak in that error's
  // text — it embeds the failing invocation and its compiled file path,
  // `dist/modules/.../x.repository.js:116` — is handled for every 5xx a few
  // lines down by `sanitizeClientMessage`, not just for this case.)
  const dbUnavailable =
    !Number.isInteger(appErr.statusCode) && isDatabaseUnavailableError(appErr);

  const statusCode = dbUnavailable
    ? 503
    : Number.isInteger(appErr.statusCode)
      ? (appErr.statusCode as number)
      : 500;

  // Two distinct messages from here on, and mixing them up is the whole bug:
  //
  //   rawMessage    — what actually happened. Goes to the log, the alert email
  //                   and the email de-dupe key. Never leaves the server.
  //   clientMessage — what the caller is allowed to read. For any 5xx that
  //                   looks like a driver/stack/path string this collapses to
  //                   "Internal Server Error", so a deploy window shows users a
  //                   plain server error instead of a Prisma invocation dump.
  //                   4xx wording is deliberate and passes through untouched.
  const rawMessage = appErr.message ?? "Internal Server Error";

  const clientMessage = dbUnavailable
    ? SERVICE_UNAVAILABLE_MESSAGE
    : sanitizeClientMessage(rawMessage, statusCode);

  const errorObject = appErr.errorObject ?? null;

  if (dbUnavailable && !res.headersSent) {
    res.setHeader("Retry-After", String(SERVICE_UNAVAILABLE_RETRY_SECONDS));
  }

  // Structured error logging
  try {
    logger.error("API Error", {
      traceId: (req as any).traceId,
      // The RAW message — `clientMessage` above may have been normalised to the
      // generic 503/500 text for the client, which must never blind the logs.
      message: rawMessage,
      ...(clientMessage !== rawMessage ? { clientMessage } : {}),
      ...(dbUnavailable ? { cause: "DATABASE_UNAVAILABLE" } : {}),
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

  // Ensure JSON response and avoid sending twice.
  //
  // Envelope matches utils/httpResponse.ts `failure()` — `code`/`data`/`messages`
  // used to be missing here, so a 500 from this handler was the ONE error shape
  // in the API without them, and clients reading `res.data.code` got `undefined`
  // during exactly the outage this handler exists for.
  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      code: statusCode,
      data: dbUnavailable ? { reason: "SERVICE_UNAVAILABLE" } : {},
      message: clientMessage,
      messages: {},
    });
  }

  // Fire-and-forget email for 5xx only — debounced to 1 per unique error per
  // minute, cluster-wide via Redis SET NX EX.
  if (statusCode >= 500) {
    // Keyed on the RAW message: keying on the sanitised one would collapse every
    // distinct 5xx in the system into the single signature "Internal Server
    // Error" and silently drop all but one alert per minute.
    const shouldSend = await acquireEmailCooldown(statusCode, rawMessage);
    if (!shouldSend) return;

    const emailTo = "ranavinit6834@gmail.com";
    const subject = `Web Sankul API Error: ${statusCode}`;
    const emailBody = `
      <html>
        <body>
          <h1>Server Error Notification</h1>
          <p><strong>Message:</strong> ${escapeHtml(rawMessage)}</p>
          <p><strong>Sent to client:</strong> ${escapeHtml(clientMessage)}</p>
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
        originalError: rawMessage,
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
