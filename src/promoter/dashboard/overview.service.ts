export type RangeKey = "today" | "week" | "month" | "year" | "all" | "custom";
export const ALLOWED_RANGES: RangeKey[] = ["today", "week", "month", "year", "all", "custom"];

// Parse a YYYY-MM-DD string into a Date, or null if absent/invalid.
function parseYmd(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveRange(
  key: RangeKey | undefined,
  now: Date,
  custom?: { startDate?: string; endDate?: string }
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (key) {
    case "today":
      return { start, end: now };
    case "week": {
      const s = new Date(start);
      s.setDate(s.getDate() - 6);
      return { start: s, end: now };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: s, end: now };
    }
    case "year": {
      const s = new Date(now.getFullYear(), 0, 1);
      return { start: s, end: now };
    }
    case "custom": {
      // startDate at 00:00:00, endDate at 23:59:59.999 (inclusive day).
      // Missing/invalid bounds fall back to an unbounded start / now end so a
      // partial custom range still returns sensible data rather than erroring.
      const s = parseYmd(custom?.startDate);
      const e = parseYmd(custom?.endDate);
      if (e) e.setHours(23, 59, 59, 999);
      return { start: s as Date | null, end: e && e <= now ? e : now };
    }
    case "all":
    default:
      return { start: null as Date | null, end: now };
  }
}

// For presets the unit is fixed; for custom we derive it from the span so the
// chart stays readable: ≤2 days → hourly, ≤92 days (~3 months) → daily, else monthly.
export function bucketFormatFor(
  range: RangeKey,
  window?: { start: Date | null; end: Date }
) {
  switch (range) {
    case "today":
      return { fmt: "%Y-%m-%d %H:00", unit: "hour" as const };
    case "week":
    case "month":
      return { fmt: "%Y-%m-%d", unit: "day" as const };
    case "custom": {
      const start = window?.start;
      const end = window?.end;
      if (!start) return { fmt: "%Y-%m", unit: "month" as const };
      const days = (end!.getTime() - start.getTime()) / 86_400_000;
      if (days <= 2) return { fmt: "%Y-%m-%d %H:00", unit: "hour" as const };
      if (days <= 92) return { fmt: "%Y-%m-%d", unit: "day" as const };
      return { fmt: "%Y-%m", unit: "month" as const };
    }
    case "year":
    case "all":
    default:
      return { fmt: "%Y-%m", unit: "month" as const };
  }
}

export interface OverviewOptions {
  rangeRaw?: string;
  startDate?: string;
  endDate?: string;
  promocodeId?: string;
  traceId?: string;
}

// NOTE: the Mongo `buildOverview` / `buildAllPromotersOverview` aggregates were
// removed during the MySQL migration — they had NO live caller (the per-promoter
// overview is served by the SQL twin `modules/promoter-data` →
// `buildPromoterOverview`, used by promoter/dashboard/dashboard.controller.ts).
// Only the pure range/bucket helpers above remain; they are consumed by
// `modules/admin-promoter/admin-promoter.service.ts`.
