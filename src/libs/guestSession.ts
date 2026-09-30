// src/libs/guestSession.ts
import jwt from "jsonwebtoken";
import { signAccessToken, verifyAccessToken } from "../utils/jwtSigner";
import { isReviewModeOn } from "./reviewMode";

/**
 * Guest login — an account-less identity (no `ws_customer` row) for catalog browse.
 *
 * ONE switch decides everything: Firebase Realtime DB `maintain.env` (read
 * server-side, libs/reviewMode.ts). While it is "staging":
 *   - `POST /client/auth/guest` hands out the guest token;
 *   - that token opens the guest-browsable GETs (middlewares/guestBrowse.ts).
 * The moment it is anything else ("production") the token stops working everywhere
 * and the endpoint refuses. No `.env` flag, no restart, no per-session state.
 *
 * The token is STATIC: an access-ring JWT `{ type: "guest", role: "guest" }` with no
 * `iat` and no `exp`, so every call returns the same string and it never expires on
 * its own. It carries no identity, so it never becomes `req.user`.
 *
 * ponytail: stateless, so a single guest cannot be revoked — only all of them, by
 * flipping Firebase or rotating the access key. Add a per-session store (Redis
 * `guest_session:<sid>`) when one guest must be cut off without the others.
 */
export const isGuestModeOn = isReviewModeOn;

export const guestToken = (): string => signAccessToken({ type: "guest", role: "guest" }, { noTimestamp: true });

/** True for a decoded payload that is a guest token. */
export const isGuestPayload = (decoded: any): boolean => decoded?.type === "guest" || decoded?.role === "guest";

/** Signature-valid guest token AND guest mode currently on. */
export const isLiveGuestToken = async (token: string): Promise<boolean> => {
  // Cheap unverified peek first so customer tokens skip the verify + Firebase read.
  if (!isGuestPayload(jwt.decode(token))) return false;
  try {
    return isGuestPayload(verifyAccessToken<any>(token)) && (await isGuestModeOn());
  } catch {
    return false;
  }
};
