// src/utils/jwtSigner.ts
//
// Wrappers around jsonwebtoken sign/verify that consult the keyring in
// config/jwtKeys.ts so we can rotate JWT secrets without invalidating
// every active session.
//
// Sign:  always with the current kid, kid embedded in the JWT header.
// Verify: read kid from header → look up secret in ring. If no kid (legacy
//         token from before this change), use the ring's legacySecret.

import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";
import { getAccessRing, getRefreshRing, KeyRing } from "../config/jwtKeys";

const signWith = (ring: KeyRing, payload: object, options: SignOptions = {}): string => {
  const secret = ring.byKid.get(ring.currentKid);
  if (!secret) {
    // buildRing already enforces this invariant; defensive guard for tests.
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
  // Peek the header without verification to learn the kid. jsonwebtoken's
  // `decode` with `complete:true` is safe here because we re-verify with the
  // matching secret immediately after.
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded && typeof decoded === "object" ? decoded.header?.kid : undefined;

  const secret = kid ? ring.byKid.get(kid) : ring.legacySecret;
  if (!secret) {
    // Unknown kid — token was signed by a key we no longer trust (rotated
    // out). Treat as invalid; jsonwebtoken would throw "invalid signature"
    // anyway, but a clear error helps debugging.
    throw new jwt.JsonWebTokenError(
      `Token kid "${kid ?? "<none>"}" is not in the active keyring.`
    );
  }
  return jwt.verify(token, secret, options) as T;
};

// ──────────────────────────────────────────────────────────────────────────────
// Access tokens
// ──────────────────────────────────────────────────────────────────────────────

export const signAccessToken = (payload: object, options: SignOptions = {}): string =>
  signWith(getAccessRing(), payload, options);

export const verifyAccessToken = <T = any>(
  token: string,
  options: VerifyOptions = {}
): T => verifyWith<T>(getAccessRing(), token, options);

// ──────────────────────────────────────────────────────────────────────────────
// Refresh tokens
// ──────────────────────────────────────────────────────────────────────────────

export const signRefreshToken = (payload: object, options: SignOptions = {}): string =>
  signWith(getRefreshRing(), payload, options);

export const verifyRefreshToken = <T = any>(
  token: string,
  options: VerifyOptions = {}
): T => verifyWith<T>(getRefreshRing(), token, options);
