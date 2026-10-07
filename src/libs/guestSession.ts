// Guest session: static guest JWT for account-less catalog browse.
import jwt from "jsonwebtoken";
import { signAccessToken, verifyAccessToken } from "../utils/jwtSigner";
import { isReviewModeOn } from "./reviewMode";

/**
 * Account-less guest identity for catalog browse. Valid only while Firebase RTDB
 * `maintain.env` is "staging" (libs/reviewMode.ts); then `POST /client/auth/guest`
 * issues it and it opens the GETs in middlewares/guestBrowse.ts. Any other value
 * disables it everywhere, with no restart.
 *
 * The token is a static access-ring JWT `{ type: "guest", role: "guest" }` with no
 * `iat`/`exp`. It carries no identity, so it never becomes `req.user`.
 *
 * ponytail: stateless, so a single guest cannot be revoked — only all of them, by
 * flipping Firebase or rotating the access key. Add a per-session store (Redis
 * `guest_session:<sid>`) when one guest must be cut off without the others.
 */
export const isGuestModeOn = isReviewModeOn;

export const guestToken = (): string => signAccessToken({ type: "guest", role: "guest" }, { noTimestamp: true });

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
