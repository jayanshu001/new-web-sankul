// IST JSON: renders every Date in API responses as ISO-8601 with a `+05:30` offset
// (2026-07-10T12:42:45.000Z -> 2026-07-10T18:12:45.000+05:30). Still the same
// instant, so client date math is unaffected. Wired once via
// `app.set("json replacer", ...)` in app.ts.

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India has no DST
const MS_PER_DAY = 86_400_000;

/** Whole days since epoch of the IST calendar date `d` falls on. */
export const istDayIndex = (d: Date): number => Math.floor((d.getTime() + IST_OFFSET_MS) / MS_PER_DAY);

/** Seconds until the next IST midnight (≥ 1). */
export const secondsToIstMidnight = (now: Date = new Date()): number => {
  const nextMidnight = (istDayIndex(now) + 1) * MS_PER_DAY - IST_OFFSET_MS;
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
};
const pad = (n: number, len = 2) => String(n).padStart(len, "0");

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
 * Express `json replacer`. toJSON runs before the replacer, so `value` is already
 * a UTC string; `this[key]` still holds the original Date.
 */
export function istJsonReplacer(this: any, key: string, value: unknown): unknown {
  const original = this?.[key];
  if (original instanceof Date) return toISTISOString(original);
  return value;
}
