import mongoose from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Course } from "../../models/course/Course.model";
import { Customer } from "../../models/customer/Customer.model";
import logger from "../../utils/logger";

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

// Shared core. When `promoterId` is undefined the match is unscoped, so totals
// sum, chart buckets merge per time-bucket, and recents merge & sort across ALL
// promoters — the aggregate "All Promoters" view falls out of the same pipeline.
async function buildOverview(promoterId: string | undefined, opts: OverviewOptions) {
  const { rangeRaw, startDate, endDate, promocodeId, traceId } = opts;
  logger.info("buildOverview service invoked", { traceId, promoterId: promoterId ?? "ALL", range: rangeRaw, promocodeId });

  const range: RangeKey = ALLOWED_RANGES.includes(rangeRaw as RangeKey)
    ? (rangeRaw as RangeKey)
    : "all";

  const now = new Date();
  const { start, end } = resolveRange(range, now, { startDate, endDate });
  const { fmt, unit } = bucketFormatFor(range, { start, end });

  const dateFilter: Record<string, unknown> = { $lte: end };
  if (start) dateFilter.$gte = start;

  const baseMatch: Record<string, unknown> = {};
  // Scope to a single promoter, or to ALL promoter-attributed rows. Either way
  // we must exclude non-promoter subscriptions (promoterId defaults to null on
  // regular customer purchases) — otherwise the aggregate counts the whole
  // collection, not just promoter activity.
  baseMatch.promoterId = promoterId
    ? mongoose.Types.ObjectId.createFromHexString(promoterId)
    : { $ne: null };
  if (start) baseMatch.createdAt = dateFilter;

  // Optional: scope to a single promocode (the promocode's _id). Composes with
  // the promoter scope and the date window above. Invalid/absent id is ignored.
  if (promocodeId && mongoose.Types.ObjectId.isValid(promocodeId)) {
    baseMatch.promocodeId = mongoose.Types.ObjectId.createFromHexString(promocodeId);
  }

  // Recents share the same window/scope as totals & chart so the three agree.
  const recentMatch: Record<string, unknown> = { ...baseMatch };

  const [totalsAgg, seriesAgg, recent] = await Promise.all([
    PackageCourseSubscription.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          subscriptions: { $sum: 1 },
          earnings: { $sum: { $ifNull: ["$paidAmount", 0] } },
          commission: {
            $sum: {
              $multiply: [
                { $ifNull: ["$paidAmount", 0] },
                { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
              ],
            },
          },
        },
      },
    ]),
    PackageCourseSubscription.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $dateToString: { format: fmt, date: "$createdAt" } },
          subscriptions: { $sum: 1 },
          earnings: { $sum: { $ifNull: ["$paidAmount", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    PackageCourseSubscription.find(recentMatch)
      .populate({
        path: "customerId",
        model: Customer,
        select: "firstName lastName phoneNumber",
      })
      .populate({ path: "courseId", model: Course, select: "name" })
      .populate({ path: "promocodeId", model: PromoCode, select: "promocode" })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const totals = totalsAgg[0] || { subscriptions: 0, earnings: 0, commission: 0 };
  const series = seriesAgg.map((row: any) => ({
    bucket: row._id,
    subscriptions: row.subscriptions,
    earnings: row.earnings,
  }));
  const recentSubscriptions = recent.map((s: any) => {
    const c = s.customerId as any;
    const course = s.courseId as any;
    const promo = s.promocodeId as any;
    const name = c
      ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unknown"
      : "Unknown";
    return {
      id: String(s._id),
      customer: {
        id: c ? String(c._id) : null,
        name,
        phoneNumber: c?.phoneNumber ?? null,
      },
      course: course ? { id: String(course._id), name: course.name ?? "" } : null,
      promocode: promo?.promocode ?? null,
      amount: s.paidAmount ?? 0,
      status: s.status ? "complete" : "pending",
      createdAt: s.createdAt,
    };
  });

  logger.info("buildOverview service completed", { traceId, promoterId: promoterId ?? "ALL", range, subscriptions: totals.subscriptions });
  return {
    range,
    window: { start, end },
    totals: {
      subscriptions: totals.subscriptions,
      earnings: Math.round(totals.earnings || 0),
      commission: Math.round(totals.commission || 0),
    },
    chart: { unit, points: series },
    recentSubscriptions,
  };
}

// Per-promoter dashboard. Backwards-compatible positional signature; pass the
// custom-range query params via `opts` when range=custom.
export async function buildPromoterOverview(
  promoterId: string,
  rangeRaw: string | undefined,
  traceId?: string,
  opts?: { startDate?: string; endDate?: string; promocodeId?: string }
) {
  return buildOverview(promoterId, {
    rangeRaw,
    traceId,
    startDate: opts?.startDate,
    endDate: opts?.endDate,
    promocodeId: opts?.promocodeId,
  });
}

// Aggregate dashboard across ALL promoters — same response shape, unscoped match.
export async function buildAllPromotersOverview(opts: OverviewOptions) {
  return buildOverview(undefined, opts);
}
