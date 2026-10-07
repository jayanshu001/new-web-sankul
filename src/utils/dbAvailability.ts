// DB availability: tells "database unreachable" apart from application failures. A DB blip
// answered with a nearby catch block's 401 would log out every mobile client
// that made a request during it; 503 makes clients back off and retry instead.
// Detection is by Prisma error code first, message substring second (driver /
// socket errors that never get a Prisma code).

import type { Response } from "express";
import { failure } from "./httpResponse";

/** Prisma connection-level error codes — none of these mean "bad request". */
const PRISMA_UNAVAILABLE_CODES = new Set([
  "P1000", // authentication failed against the database server
  "P1001", // can't reach database server
  "P1002", // database server reached but timed out
  "P1008", // operation timed out
  "P1017", // server has closed the connection
  "P2024", // timed out fetching a new connection from the pool
]);

/** Raw socket / driver failures that arrive without a Prisma code. */
const UNAVAILABLE_MESSAGE_FRAGMENTS = [
  "server has closed the connection",
  "can't reach database server",
  "timed out fetching a new connection",
  "connection closed",
  "connection lost",
  "econnrefused",
  "econnreset",
  "etimedout",
  "epipe",
];

/**
 * True when `err` means the database was unavailable; callers answer 503.
 * Deliberately narrow: application-level Prisma errors (missing column, unique
 * violation) must not match, or real bugs would masquerade as outages.
 */
export const isDatabaseUnavailableError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && PRISMA_UNAVAILABLE_CODES.has(code)) return true;

  const message = String((err as { message?: unknown }).message ?? "").toLowerCase();
  if (!message) return false;
  return UNAVAILABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
};

export const SERVICE_UNAVAILABLE_RETRY_SECONDS = 5;

export const SERVICE_UNAVAILABLE_MESSAGE =
  "Service temporarily unavailable. Please try again in a moment.";

/**
 * 503 + Retry-After with `data.reason = "SERVICE_UNAVAILABLE"`. Auth-adjacent
 * catch blocks must route DB failures here, never to 401 (clients log out on 401).
 */
export const sendServiceUnavailable = (res: Response): Response => {
  res.setHeader("Retry-After", String(SERVICE_UNAVAILABLE_RETRY_SECONDS));
  return failure(res, SERVICE_UNAVAILABLE_MESSAGE, 503, {}, {
    reason: "SERVICE_UNAVAILABLE",
  });
};

export default isDatabaseUnavailableError;
