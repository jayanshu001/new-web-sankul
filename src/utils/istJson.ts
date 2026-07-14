// Global JSON date serializer → IST.
//
// Timestamps are STORED in UTC (correct, unchanged). This only controls how Date
// values are rendered in API responses: instead of the default UTC `...Z` ISO
// string, every Date is emitted as an ISO-8601 string in IST with the `+05:30`
// offset, e.g. 2026-07-10T12:42:45.000Z  ->  2026-07-10T18:12:45.000+05:30
//
// The value stays a valid ISO-8601 instant, so `new Date(str)` on any client still
// resolves to the exact same moment — clients doing date math are unaffected, while
// clients that display the raw string now see IST. Wired once via Express's
// `app.set("json replacer", ...)` in app.ts, so it applies to EVERY res.json()
// without touching individual transformers.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+05:30, India has no DST
const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** Format a Date as an ISO-8601 string expressed in IST (`...+05:30`). */
export function toISTISOString(d: Date): string {
  // Shift the instant by +5:30, then read UTC parts to get IST wall-clock values.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return (
    `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}` +
    `T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}` +
    `.${pad(ist.getUTCMilliseconds(), 3)}+05:30`
  );
}

/**
 * Express `json replacer`. JSON.stringify calls Date.prototype.toJSON before the
 * replacer runs, so `value` is already the UTC string — but `this[key]` still holds
 * the original Date, which is what we inspect to detect and reformat it.
 */
export function istJsonReplacer(this: any, key: string, value: unknown): unknown {
  const original = this?.[key];
  if (original instanceof Date) return toISTISOString(original);
  return value;
}
