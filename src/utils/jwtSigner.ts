// JWT signer: jsonwebtoken wrappers over the config/jwtKeys.ts keyring: sign with the current
// kid (embedded in the header); verify with the header kid's secret, or the
// ring's legacySecret when the token has no kid.

import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";
import { getAccessRing, getRefreshRing, KeyRing } from "../config/jwtKeys";

const signWith = (ring: KeyRing, payload: object, options: SignOptions = {}): string => {
  const secret = ring.byKid.get(ring.currentKid);
  if (!secret) {
    throw new Error(`[jwtSigner] Current kid "${ring.currentKid}" missing from ring.`);
  }
  return jwt.sign(payload, secret, {
    ...options,
    keyid: ring.currentKid,
  });
};

const verifyWith = <T = any>(
  ring: KeyRing,
  token: string,
  options: VerifyOptions = {}
): T => {
  // Unverified peek is safe: the token is verified with the matching secret below.
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded && typeof decoded === "object" ? decoded.header?.kid : undefined;

  const secret = kid ? ring.byKid.get(kid) : ring.legacySecret;
  if (!secret) {
    // Rotated-out kid; a clearer error than jsonwebtoken's "invalid signature".
    throw new jwt.JsonWebTokenError(
      `Token kid "${kid ?? "<none>"}" is not in the active keyring.`
    );
  }
  return jwt.verify(token, secret, options) as T;
};

export const signAccessToken = (payload: object, options: SignOptions = {}): string =>
  signWith(getAccessRing(), payload, options);

export const verifyAccessToken = <T = any>(
  token: string,
  options: VerifyOptions = {}
): T => verifyWith<T>(getAccessRing(), token, options);

export const signRefreshToken = (payload: object, options: SignOptions = {}): string =>
  signWith(getRefreshRing(), payload, options);

export const verifyRefreshToken = <T = any>(
  token: string,
  options: VerifyOptions = {}
): T => verifyWith<T>(getRefreshRing(), token, options);
