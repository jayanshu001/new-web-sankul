// Media tokens: opaque, signed tokens that replace every raw media reference in client
// responses. The client exchanges one at POST /client/media/resolve, which
// re-verifies it, re-checks entitlement and returns a short-lived URL. The token
// carries no URL. Security: dedicated secret (never the auth key ring) plus the
// `ws-media` audience prevent cross-use as a Bearer; short TTL (default 5 min);
// bound to the issuing customer (`cust`).

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

// `null` for free media (`free: true`).
export type MediaScope =
  | { kind: "course"; id: number }
  | { kind: "package"; id: number }
  | { kind: "liveCourse"; id: number }
  | { kind: "ebook"; id: number }
  | { kind: "trusted" }; // verified at issue time where no cheap re-check exists; short TTL is the guard

export interface MediaClaims {
  k: MediaKind;
  id: number;                 // primary media id (videoId / sessionId / audioNoteId / ebookId)
  scope?: MediaScope | null;  // entitlement scope; omit/null for free media
  free?: boolean;             // free content — resolve skips entitlement (still short-lived + customer-bound)
  cust: number;               // issuing customer id — resolve must match req.user.id
  /**
   * `liveSession` only: the live course the session was opened from. A shared
   * session hangs off several courses, so entitlement is judged against this one;
   * absent = Live Now entry point (any linked course grants access). Not a `scope`,
   * because `entitled()` would then reject the 3-minute preview caller; the
   * liveSession branch runs the full-or-preview gate itself.
   */
  lc?: number;
}

const MEDIA_TTL_SECONDS = Number(process.env.MEDIA_TOKEN_TTL_SECONDS) || 5 * 60;
const MEDIA_AUDIENCE = "ws-media";

// Fallback is derived to be distinct from the auth secret, so media and auth tokens
// never validate under each other's verifier.
const MEDIA_SECRET =
  process.env.MEDIA_TOKEN_SECRET ||
  `${process.env.JWT_ACCESS_SECRET ?? "ws"}::media-v1`;

// Sample-PDF kinds carry no expiry: any user can mint one, so a TTL protected nothing
// and broke cached/skewed-clock reads. Signature, audience, Bearer-gated resolve, the
// ACTIVE check and the short-lived presign still guard them. Does not apply to
// `free: true` on other kinds.
const NON_EXPIRING_KINDS = new Set<MediaKind>(["ebookDemo", "bookDemo"]);

/**
 * Mint a media token. `ttlSeconds` can only shorten the default TTL (so a preview
 * token can't outlive the preview window) and overrides the demo no-expiry rule.
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

// Tokens embedded in a 24h `cacheRoute` body would replay expired after 5 minutes,
// so they are re-minted on the way out of the cache. Safe because a token is only a
// pointer: resolve re-verifies, binds to the caller and re-checks entitlement live.
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

// Verifies signature + audience but ignores expiry; used only to recover claims.
const decodeStaleMediaToken = (token: string): MediaClaims | null => {
  try {
    const decoded = jwt.verify(token, MEDIA_SECRET, {
      audience: MEDIA_AUDIENCE,
      ignoreExpiration: true,
    }) as MediaClaims & { typ?: string };
    return decoded.typ === "media" ? decoded : null;
  } catch {
    return null; // not ours — leave the value alone
  }
};

/**
 * Re-mint one token for `customerId`, or null to leave it as-is. Excluded:
 *  - `liveSession`: a preview token's clamped TTL isn't recoverable from claims,
 *    so re-minting would restore a full 5 minutes.
 *  - a non-free token issued to another customer (shared cache entry): never
 *    widen access, leave it to 403.
 */
const reissueMediaToken = (raw: string, customerId: number): string | null => {
  if (raw.length < 60 || !JWT_SHAPE.test(raw)) return null;
  const c = decodeStaleMediaToken(raw);
  if (!c || c.k === "liveSession") return null;

  // `bookDemo` (resolve skips the issuer match) and `free` content may be re-bound
  // to the current reader.
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
 * Re-mint every media token in a freshly parsed response body, in place. Tokens are
 * detected by shape + signature, not field name, so any emitter is covered.
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

/** Throws MediaTokenError (`expired` set on expiry) so resolve can map to 401/410. */
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
