// Live preview tracking: HMAC tracking id for a customer's live-session preview.
import crypto from "crypto";

/**
 * `previewTrackingId`, echoed on the live-session preview heartbeat/stop calls,
 * is an HMAC over (customer, session) rather than a stored value because:
 *  - the 180s trial is one allowance per (customer, session), so the id must be
 *    stable across devices and joins;
 *  - a SCHEDULED session hands one out without creating a preview row;
 *  - binding both ids catches the FE heartbeating the wrong session.
 * It is a correlation check, not a security boundary (entitlement is always
 * re-derived from `req.user.id`), so a mismatch is a 422, not a 403.
 */

// Salted apart from the auth/media secrets so a leaked id can't be probed against them.
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

/** Constant-time compare; length is checked first because `timingSafeEqual` throws on mismatch. */
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
