// src/utils/mediaToken.ts
//
// Short-lived, signed "media tokens" that replace every raw media reference
// (video id / AWS-S3 key / YouTube-Vimeo id / PDF or audio URL) in client API
// responses. The list/detail endpoints emit ONLY this opaque token; the client
// exchanges it at POST /client/media/resolve, where the backend re-validates it,
// re-checks entitlement, and resolves the actual (short-lived) media URL.
//
// Security properties:
//   - Signed with a DEDICATED secret (never the auth key ring), so a media token
//     can never be replayed as an Authorization Bearer, nor vice-versa.
//   - `audience: "ws-media"` — a second guard against cross-use.
//   - Short TTL (default 5 min) — an intercepted token expires quickly; the
//     resolved media URL is itself short-lived / natively time-limited.
//   - Bound to the issuing customer (`cust`) — resolve rejects a token presented
//     by a different user.
//
// This is NOT the AES-CBC {token, ciphertext} scheme (that only obfuscated). A
// media token carries NO decryptable URL — the URL never leaves the server until
// resolve re-authorizes it.

import jwt, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";

export type MediaKind =
  | "video"          // recorded video (course/package/category/catalog/free) → videoResolver
  | "liveRecording"  // live-course folder recording (StreamOS VOD)            → videoResolver / VOD meta
  | "liveSession"    // in-progress / replay live session (StreamOS)           → getStreamDetails
  | "audioNote"      // customer voice note (private Spaces object)            → presigned GET
  | "ebook"          // purchased ebook PDF (Spaces object)                   → presigned GET
  | "ebookDemo"      // free ebook sample PDF (Spaces object)                 → presigned GET
  | "bookDemo"       // free physical-book sample PDF (Spaces object)         → presigned GET
  | "material";      // study material PDF / direct link (Spaces or external) → presigned GET / passthrough

// Normalized entitlement scope the resolver can re-check with a simple helper.
// `null` when the media is free (`free: true`) and needs no entitlement.
export type MediaScope =
  | { kind: "course"; id: number }
  | { kind: "package"; id: number }
  | { kind: "liveCourse"; id: number }
  | { kind: "ebook"; id: number }
  | { kind: "trusted" }; // entitlement was verified at issue-time; short TTL is the guard
                         // (used where the emitting endpoint's gate has no cheap re-check helper)

export interface MediaClaims {
  k: MediaKind;
  id: number;                 // primary media id (videoId / sessionId / audioNoteId / ebookId)
  scope?: MediaScope | null;  // entitlement scope; omit/null for free media
  free?: boolean;             // free content — resolve skips entitlement (still short-lived + customer-bound)
  cust: number;               // issuing customer id — resolve must match req.user.id
  /**
   * `liveSession` ONLY — the live course the session was opened FROM (the entry
   * point). A shared session can hang off several courses, so entitlement must be
   * judged against THIS one, not "any linked course". Absent = the Live Now entry
   * point (no course selected → any linked course may grant access).
   *
   * Deliberately NOT a `scope`: `scope` is checked by `entitled()` before the
   * per-kind switch and would reject the legitimate 3-minute PREVIEW caller. The
   * liveSession branch re-runs the full-OR-preview gate itself.
   */
  lc?: number;
}

const MEDIA_TTL_SECONDS = Number(process.env.MEDIA_TOKEN_TTL_SECONDS) || 5 * 60;
const MEDIA_AUDIENCE = "ws-media";

// Dedicated secret. Prefer an explicit env var; otherwise derive a value that is
// GUARANTEED distinct from the auth secret so media tokens and auth tokens can
// never validate under each other's verifier. (JWT_ACCESS_SECRET is validated at
// boot, so the fallback is always defined.)
const MEDIA_SECRET =
  process.env.MEDIA_TOKEN_SECRET ||
  `${process.env.JWT_ACCESS_SECRET ?? "ws"}::media-v1`;

/**
 * Mint a short-lived media token. Returns the compact JWT string.
 *
 * `ttlSeconds` shortens (never lengthens) the default TTL — used to make a
 * PREVIEW token expire no later than the caller's remaining preview window, so
 * an issued token can't outlive the entitlement that justified it.
 */
export const signMediaToken = (claims: MediaClaims, ttlSeconds?: number): string =>
  jwt.sign({ typ: "media", ...claims }, MEDIA_SECRET, {
    expiresIn:
      typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)
        ? Math.max(1, Math.min(MEDIA_TTL_SECONDS, Math.floor(ttlSeconds)))
        : MEDIA_TTL_SECONDS,
    audience: MEDIA_AUDIENCE,
  });

export class MediaTokenError extends Error {
  constructor(message: string, readonly expired = false) {
    super(message);
    this.name = "MediaTokenError";
  }
}

/**
 * Verify + decode a media token. Throws MediaTokenError (expired flag set on
 * expiry) so the resolve controller can map to 401/410 cleanly.
 */
export const verifyMediaToken = (token: string): MediaClaims & { typ: string } => {
  try {
    const decoded = jwt.verify(token, MEDIA_SECRET, { audience: MEDIA_AUDIENCE }) as
      & MediaClaims
      & { typ?: string };
    if (decoded.typ !== "media") throw new MediaTokenError("Not a media token.");
    return decoded as MediaClaims & { typ: string };
  } catch (err) {
    if (err instanceof TokenExpiredError) throw new MediaTokenError("Media token expired.", true);
    if (err instanceof JsonWebTokenError) throw new MediaTokenError("Invalid media token.");
    throw err;
  }
};
