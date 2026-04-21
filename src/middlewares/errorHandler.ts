// src/middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";
import { sendEmail } from "../utils/emailService";
import logger from "../utils/logger";

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

// Prevent email floods — max one notification per unique error message per minute
const _errorEmailCooldown = new Map<string, number>();
const ERROR_EMAIL_COOLDOWN_MS = 60_000;

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
      body: req.body,
      query: req.query,
      params: req.params,
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

  // Fire-and-forget email for 5xx only — debounced to 1 per unique error per minute
  if (statusCode >= 500) {
    const cooldownKey = `${statusCode}:${message}`;
    const lastSent = _errorEmailCooldown.get(cooldownKey) ?? 0;
    const shouldSend = Date.now() - lastSent > ERROR_EMAIL_COOLDOWN_MS;
    if (shouldSend) _errorEmailCooldown.set(cooldownKey, Date.now());
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
