// Log scrubber: deny-list redaction for the request logger and crash reporter. Replaces the
// value (not the key) so the logged shape survives. Matching is case-insensitive
// and substring-based (`accessToken` matches `token`).

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

// Exact-name matches only: substring-matching "key" would redact every
// objectKey/cacheKey/keyword. `key` is the per-user AES download key
// (PUT /client/downloads/encryption-key); the admin cms `key` enum and offline
// `key` search term are redacted too, as accepted collateral.
const SENSITIVE_EXACT_KEYS = ["key"];

const REDACTED = "[REDACTED]";

const isSensitiveKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return SENSITIVE_EXACT_KEYS.includes(k) || SENSITIVE_KEYS.some((s) => k.includes(s));
};

/** Deep-clones with sensitive values replaced by `[REDACTED]`; circular refs become `[CIRCULAR]`. */
export const scrub = <T = unknown>(input: T, _seen?: WeakSet<object>): T => {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;

  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(input as object)) return "[CIRCULAR]" as unknown as T;
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((v) => scrub(v, seen)) as unknown as T;
  }

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
