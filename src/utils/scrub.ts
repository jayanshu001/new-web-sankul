// src/utils/scrub.ts
//
// PII / secret deny-list scrubber. Used by the request logger and the crash
// reporter so log/email payloads never carry plaintext passwords, OTPs,
// tokens, or financial identifiers.
//
// Strategy: deny-list. We replace the VALUE (not the key) so the shape of the
// logged body is preserved — helpful for debugging without leaking secrets.
//
// Adding a new sensitive field? Append it to SENSITIVE_KEYS below. Matching
// is case-insensitive and substring-based, so `accessToken` matches `token`
// and `currentPassword` matches `password`.

const SENSITIVE_KEYS = [
  "password",
  "currentpassword",
  "newpassword",
  "confirmpassword",
  "otp",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "authorization",
  "cookie",
  "set-cookie",
  "razorpay_signature",
  "signature",
  "apikey",
  "api_key",
  "x-api-key",
  // Financial identifiers — bank/card details are the primary PII the
  // referral + payment endpoints handle.
  "bankaccount",
  "accountnumber",
  "ifsccode",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "pan",
  "upi",
];

const REDACTED = "[REDACTED]";

const isSensitiveKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
};

/**
 * Deep-clones the input with sensitive values replaced by `[REDACTED]`.
 * Returns the original primitive unchanged. Handles circular refs by
 * tracking seen objects.
 */
export const scrub = <T = unknown>(input: T, _seen?: WeakSet<object>): T => {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;

  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(input as object)) return "[CIRCULAR]" as unknown as T;
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((v) => scrub(v, seen)) as unknown as T;
  }

  // Buffers / Dates / etc. — leave as-is so toString/toJSON preserve shape.
  if (Buffer.isBuffer(input) || input instanceof Date || input instanceof RegExp) {
    return input;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = value === undefined || value === null ? value : REDACTED;
    } else {
      out[key] = scrub(value, seen);
    }
  }
  return out as T;
};

export const scrubHeaders = (
  headers: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => (headers ? (scrub(headers) as any) : headers);
