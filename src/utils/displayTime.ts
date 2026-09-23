// Server-side IST formatter for response payloads. Clients render this string
// as-is so users see a proper local time instead of a raw UTC ISO. The raw
// UTC `scheduledAt` is still returned alongside it for any client-side math.
//
// Example: 2026-05-27T14:30:00.000Z -> "27 May 2026, 8:00 pm"

const FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatScheduledAt(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return FORMATTER.format(d);
}
