// src/utils/streamosSignature.ts
//
// Verifies the `X-Streamos-Signature` header on StreamOS v1 webhook deliveries.
//
// Header format:  t=<unix-seconds>,v1=<hex hmac-sha256>
// The HMAC is computed with the `signing_secret` returned once by POST /webhooks/.
//
// ⚠ UNCONFIRMED: the docs say "Timestamp and HMAC-SHA256 of the raw body" but do
// not state whether the signed payload is the raw body alone or the Stripe-style
// `<t>.<raw body>`. Both are accepted below and the matched scheme is logged, so
// the first real delivery tells us which it is; pin it then and delete the other.
// Accepting both is not a weakening — neither can be forged without the secret.

import crypto from "crypto";

export type SignatureScheme = "timestamped" | "body-only";

export interface VerifyResult {
  ok: boolean;
  /** Which payload construction matched — log it, then pin the scheme. */
  scheme?: SignatureScheme;
  reason?: string;
}

/** Deliveries older than this are rejected as replays. */
const MAX_SKEW_SECONDS = 300;

function parseHeader(header: string): { t: number; v1: string } | null {
  const parts = header.split(",").map((p) => p.trim());
  let t: number | null = null;
  let v1: string | null = null;

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) t = n;
    } else if (key === "v1") {
      v1 = value;
    }
  }

  return t !== null && v1 ? { t, v1 } : null;
}

/** Constant-time hex compare that tolerates length mismatch without throwing. */
function hexEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const hmac = (secret: string, payload: string | Buffer): string =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

/**
 * @param rawBody  The UNPARSED request body (`req.rawBody`). A re-serialised
 *                 object will not match — key order and spacing differ.
 * @param nowSeconds Injectable for tests; defaults to the wall clock.
 */
export function verifyStreamosSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VerifyResult {
  if (!secret) return { ok: false, reason: "signing secret not configured" };
  if (!rawBody || rawBody.length === 0) return { ok: false, reason: "raw body unavailable" };
  if (!signatureHeader) return { ok: false, reason: "missing X-Streamos-Signature" };

  const parsed = parseHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "malformed X-Streamos-Signature" };

  const age = Math.abs(nowSeconds - parsed.t);
  if (age > MAX_SKEW_SECONDS) {
    return { ok: false, reason: `timestamp outside ${MAX_SKEW_SECONDS}s window (age ${age}s)` };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");

  // Stripe-style: HMAC over "<t>.<body>".
  const timestamped = Buffer.concat([Buffer.from(`${parsed.t}.`, "utf8"), body]);
  if (hexEquals(hmac(secret, timestamped), parsed.v1)) {
    return { ok: true, scheme: "timestamped" };
  }
  if (hexEquals(hmac(secret, body), parsed.v1)) {
    return { ok: true, scheme: "body-only" };
  }

  return { ok: false, reason: "signature mismatch" };
}
