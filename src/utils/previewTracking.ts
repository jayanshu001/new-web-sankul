import crypto from "crypto";

/**
 * `previewTrackingId` — the handle the app echoes back on
 * POST /client/live-sessions/:id/preview/heartbeat and .../preview/stop.
 *
 * It is DERIVED, not stored: an HMAC over (customer, session). That choice is
 * load-bearing, not an optimisation —
 *
 *  • **Stable across devices and installs.** The trial is one shared 180-second
 *    allowance per (customer, session); a per-open random id would give each
 *    device a different handle for the same window, and rotating it on every join
 *    would invalidate the id a second device is still heartbeating with.
 *  • **Verifiable without a row.** A SCHEDULED session hands out a tracking id
 *    without creating a preview row (opening a page that has nothing to watch
 *    must not start the trial), so a stored id would not exist yet.
 *  • **Bound to both ids.** Replaying another session's — or another student's —
 *    tracking id fails the compare, which catches the FE bug of heartbeating the
 *    wrong session against the right token.
 *
 * It is NOT a security boundary and is not treated as one: every endpoint
 * independently re-derives entitlement from `req.user.id`. It is a correlation
 * check, so a mismatch is a 422 client bug, not a 403.
 */

// Own key material, salted apart from the auth and media secrets so a leaked
// tracking id can never be probed against them. Mirrors utils/mediaToken.ts.
const PREVIEW_TRACKING_SECRET =
  process.env.PREVIEW_TRACKING_SECRET ||
  process.env.MEDIA_TOKEN_SECRET ||
  `${process.env.JWT_ACCESS_SECRET ?? "ws"}::live-preview-v1`;

/** Deterministic tracking id for one customer's trial of one live session. */
export const buildPreviewTrackingId = (customerId: number, liveSessionId: number): string =>
  crypto
    .createHmac("sha256", PREVIEW_TRACKING_SECRET)
    .update(`livePreview:${customerId}:${liveSessionId}`)
    .digest("hex")
    .slice(0, 32);

/**
 * Constant-time compare of a client-supplied tracking id.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length is checked first —
 * a client can send anything. Non-hex / wrong-length input is simply invalid.
 */
export const isValidPreviewTrackingId = (
  candidate: string | null | undefined,
  customerId: number,
  liveSessionId: number
): boolean => {
  if (typeof candidate !== "string") return false;
  const expected = buildPreviewTrackingId(customerId, liveSessionId);
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
};
