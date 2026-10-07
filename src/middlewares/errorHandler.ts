// Error handler: global error middleware (failure envelope, 503 on DB outage, 5xx alert email).
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

export interface AppError extends Error {
  statusCode?: number;
  errorObject?: unknown;
}

export class HttpError extends Error implements AppError {
  statusCode: number;
  errorObject?: unknown;

  constructor(statusCode: number, message: string, errorObject?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.errorObject = errorObject;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}

// At most one alert email per unique error per minute, cluster-wide: the atomic
// `SET ... NX EX` in Redis lets the first pod win and the others no-op.
const ERROR_EMAIL_COOLDOWN_SECONDS = 60;
const errorEmailCooldownKey = (statusCode: number, message: string) =>
  `err-email-cooldown:${statusCode}:${message}`;

/** True if this pod won the cooldown slot. Fail-open when Redis is down (one alert per pod beats none). */
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

  // A database outage (e.g. during a deploy) is transient, not a bug: answer 503 +
  // Retry-After so clients back off and retry. Only when the error carried no explicit
  // status; an intentional `new HttpError(...)` always wins.
  const dbUnavailable =
    !Number.isInteger(appErr.statusCode) && isDatabaseUnavailableError(appErr);

  const statusCode = dbUnavailable
    ? 503
    : Number.isInteger(appErr.statusCode)
      ? (appErr.statusCode as number)
      : 500;

  // rawMessage goes to the log, alert email and de-dupe key and never leaves the server.
  // clientMessage is what the caller may read: an internal-looking 5xx message collapses
  // to "Internal Server Error"; 4xx wording passes through untouched.
  const rawMessage = appErr.message ?? "Internal Server Error";

  const clientMessage = dbUnavailable
    ? SERVICE_UNAVAILABLE_MESSAGE
    : sanitizeClientMessage(rawMessage, statusCode);

  const errorObject = appErr.errorObject ?? null;

  const clientErrorData =
    statusCode < 500 &&
    typeof errorObject === "object" &&
    errorObject !== null &&
    !Array.isArray(errorObject)
      ? (errorObject as Record<string, unknown>)
      : {};

  if (dbUnavailable && !res.headersSent) {
    res.setHeader("Retry-After", String(SERVICE_UNAVAILABLE_RETRY_SECONDS));
  }

  try {
    logger.error("API Error", {
      traceId: (req as any).traceId,
      message: rawMessage,
      ...(clientMessage !== rawMessage ? { clientMessage } : {}),
      ...(dbUnavailable ? { cause: "DATABASE_UNAVAILABLE" } : {}),
      statusCode,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      stack: appErr.stack,
      // Scrubbed so OTPs/passwords never land in the log file or the alert email.
      body: scrub(req.body),
      query: scrub(req.query),
      params: scrub(req.params),
    });
  } catch {
    // Avoid logger crashes from non‑serializable req.body etc.
  }

  // Same envelope as utils/httpResponse.ts `failure()`; clients read `code`.
  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      code: statusCode,
      data: dbUnavailable ? { reason: "SERVICE_UNAVAILABLE" } : clientErrorData,
      message: clientMessage,
      messages: {},
    });
  }

  if (statusCode >= 500) {
    // Keyed on the raw message: the sanitised one would collapse every distinct 5xx
    // into one signature and drop all but one alert per minute.
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
};

export default errorHandler;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
