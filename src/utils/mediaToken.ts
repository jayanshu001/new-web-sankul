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

// DEMO kinds carry NO expiry. A demo is free sample content that every
// authenticated user can mint a token for on demand, so a 5-minute window
// protected nothing while reliably breaking legitimate reads (a token replayed
// from a 24h route-cache entry, an app-side cached detail payload, or a device
// with a skewed clock). What actually guards these is unchanged: the signature +
// `ws-media` audience prove we issued it, `/client/media/resolve` still requires
// a Bearer token, the ebook must still be ACTIVE at resolve time, and the URL it
// hands back is a Spaces presign that expires in minutes.
//
// This does NOT extend to `free: true` on other kinds (free videos/materials) —
// only to the two sample-PDF kinds.
const NON_EXPIRING_KINDS = new Set<MediaKind>(["ebookDemo", "bookDemo"]);

/**
 * Mint a media token. Returns the compact JWT string.
 *
 * `ttlSeconds` shortens (never lengthens) the default TTL — used to make a
 * PREVIEW token expire no later than the caller's remaining preview window, so
 * an issued token can't outlive the entitlement that justified it. Passing it
 * explicitly also overrides the no-expiry rule for demo kinds.
 */
export const signMediaToken = (claims: MediaClaims, ttlSeconds?: number): string => {
  const clamped =
    typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)
      ? Math.max(1, Math.min(MEDIA_TTL_SECONDS, Math.floor(ttlSeconds)))
      : null;
  const options: jwt.SignOptions = { audience: MEDIA_AUDIENCE };
  if (clamped !== null) options.expiresIn = clamped;
  else if (!NON_EXPIRING_KINDS.has(claims.k)) options.expiresIn = MEDIA_TTL_SECONDS;
  return jwt.sign({ typ: "media", ...claims }, MEDIA_SECRET, options);
};

// ---------------------------------------------------------------------------
// Re-issuing tokens embedded in a CACHED response body
// ---------------------------------------------------------------------------
// Media tokens live for 5 minutes; several of the endpoints that emit them are
// wrapped in `cacheRoute` with a 24h TTL (client ebook/book/course/material/
// free/... list+detail). The cached body therefore replays a token that was
// minted when the entry was WARMED, so every hit after the first 5 minutes
// hands the app an already-expired token — and the app's "refetch detail, retry
// resolve" fallback re-reads the SAME cached body, so the retry fails too.
//
// The fix is to re-mint the tokens on the way out of the cache. That is safe
// because a media token is only a POINTER: `/client/media/resolve` re-verifies
// the signature, binds the token to the caller, and re-checks entitlement LIVE
// for every kind (course/package/liveCourse/ebook via `entitled()`, material via
// an ownership re-query, liveSession via the preview-state gate). A fresh token
// therefore grants exactly what a fresh request would have granted.

const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

/** Verify signature + audience but IGNORE expiry — used only to recover claims. */
const decodeStaleMediaToken = (token: string): MediaClaims | null => {
  try {
    const decoded = jwt.verify(token, MEDIA_SECRET, {
      audience: MEDIA_AUDIENCE,
      ignoreExpiration: true,
    }) as MediaClaims & { typ?: string };
    return decoded.typ === "media" ? decoded : null;
  } catch {
    return null; // wrong secret / not ours / malformed — leave the value alone
  }
};

/**
 * Re-mint one token string for `customerId`, or null when it must be left as-is.
 *
 * Deliberate exclusions:
 *  - `liveSession` — a PREVIEW token is clamped to the remaining trial window
 *    (`ttlSeconds`), which is not recoverable from the claims. Re-minting would
 *    silently restore a full 5 minutes. Live routes are not cached today; this
 *    keeps that invariant true if one ever is.
 *  - a non-free token issued to ANOTHER customer (only reachable from a
 *    `scope:"shared"` cache entry) — never widen access, leave it to 403.
 */
const reissueMediaToken = (raw: string, customerId: number): string | null => {
  if (raw.length < 60 || !JWT_SHAPE.test(raw)) return null;
  const c = decodeStaleMediaToken(raw);
  if (!c || c.k === "liveSession") return null;

  // `bookDemo` is public (resolve skips the issuer match) and `free` content is
  // ungated, so both may be re-bound to whoever is reading the cached body —
  // that also repairs a shared-scope entry minted under a different account.
  const rebindable = c.free === true || c.k === "bookDemo";
  const cust = rebindable ? customerId : c.cust;
  if (cust !== customerId) return null;

  return signMediaToken({
    k: c.k,
    id: c.id,
    ...(c.scope ? { scope: c.scope } : {}),
    ...(c.free ? { free: true } : {}),
    cust,
    ...(c.lc != null ? { lc: c.lc } : {}),
  });
};

const MAX_REFRESH_DEPTH = 12;

/**
 * Walk a (freshly parsed, owned) response body and re-mint every media token in
 * it for `customerId`. Mutates in place. Tokens are detected by SHAPE + a
 * signature check rather than by field name, so this covers `mediaToken`,
 * `demoMediaToken`, `bookMediaToken` and any future emitter without a keep-list.
 */
export const refreshMediaTokensInPlace = (
  node: unknown,
  customerId: number,
  depth = 0
): void => {
  if (!node || typeof node !== "object" || depth > MAX_REFRESH_DEPTH) return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string") {
        const next = reissueMediaToken(v, customerId);
        if (next) node[i] = next;
      } else {
        refreshMediaTokensInPlace(v, customerId, depth + 1);
      }
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string") {
      const next = reissueMediaToken(v, customerId);
      if (next) obj[key] = next;
    } else {
      refreshMediaTokensInPlace(v, customerId, depth + 1);
    }
  }
};

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
