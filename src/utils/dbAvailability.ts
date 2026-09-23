// src/utils/dbAvailability.ts
//
// Tells an INFRASTRUCTURE failure (the database is unreachable / the connection
// died) apart from an application failure (bad input, missing row, logic bug).
//
// Why this matters more than it looks: without it, a database blip surfaces to
// the client as whatever the nearest catch block happens to return. In
// authenticate.ts that was `401 "Invalid or expired token."` — and every mobile
// client treats 401 as "your session is dead, go to the login screen". A 30
// second DB hiccup would therefore mass-log-out every customer who made a
// request during it, and none of them could log back in until the DB returned.
//
// 503 is the correct answer for this class: "the server is fine as an API, the
// dependency is down, retry shortly" — clients back off and retry instead of
// destroying the user's session.
//
// Detection is by Prisma error code first (stable), message substring second
// (covers driver/socket errors that never get a Prisma code).

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
 * True when `err` means "the database was unavailable", not "the request was
 * wrong". Callers should answer 503 + Retry-After rather than 4xx or a bare 500.
 *
 * Deliberately narrow: a query that fails on a missing column, a unique-key
 * violation or any other application-level Prisma error must NOT match, or a
 * real bug would masquerade as a transient outage and never get fixed.
 */
export const isDatabaseUnavailableError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && PRISMA_UNAVAILABLE_CODES.has(code)) return true;

  const message = String((err as { message?: unknown }).message ?? "").toLowerCase();
  if (!message) return false;
  return UNAVAILABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
};

/** Seconds to advertise in `Retry-After` when answering 503. */
export const SERVICE_UNAVAILABLE_RETRY_SECONDS = 5;

/** Single client-facing message for the DB-unavailable case (never leak internals). */
export const SERVICE_UNAVAILABLE_MESSAGE =
  "Service temporarily unavailable. Please try again in a moment.";

/**
 * The one way to answer "the database is down": 503 + Retry-After, standard
 * envelope, `data.reason = "SERVICE_UNAVAILABLE"`.
 *
 * Every auth-adjacent catch block must route DB failures HERE rather than to its
 * own 401 — clients log the user out on 401, so a DB blip answered with 401
 * destroys sessions it has no business touching.
 */
export const sendServiceUnavailable = (res: Response): Response => {
  res.setHeader("Retry-After", String(SERVICE_UNAVAILABLE_RETRY_SECONDS));
  return failure(res, SERVICE_UNAVAILABLE_MESSAGE, 503, {}, {
    reason: "SERVICE_UNAVAILABLE",
  });
};

export default isDatabaseUnavailableError;
