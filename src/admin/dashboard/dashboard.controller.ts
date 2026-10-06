import { Request, Response } from "express";
import * as adminDashSql from "../../modules/admin-dashboard/admin-dashboard.service";

type RangePreset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "prevMonth"
  | "year"
  | "custom";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_CUSTOM_WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000; // ~2 years

function istStartOfDay(input: string): Date | null {
  // Accepts YYYY-MM-DD or ISO; returns the UTC instant corresponding to 00:00:00 IST of that calendar day.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!m) {
    const d = new Date(input);
    if (isNaN(d.getTime())) return null;
    // Convert to IST calendar day, then take start-of-day IST
    const istMs = d.getTime() + IST_OFFSET_MS;
    const istDay = new Date(istMs);
    const y = istDay.getUTCFullYear();
    const mo = istDay.getUTCMonth();
    const da = istDay.getUTCDate();
    return new Date(Date.UTC(y, mo, da, 0, 0, 0, 0) - IST_OFFSET_MS);
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  return new Date(Date.UTC(y, mo, da, 0, 0, 0, 0) - IST_OFFSET_MS);
}

function istEndOfDay(input: string): Date | null {
  const start = istStartOfDay(input);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function resolveCustom(from: string | undefined, to: string | undefined):
  | { ok: true; window: { start: Date; end: Date; prevStart: Date; prevEnd: Date } }
  | { ok: false; message: string } {
  if (!from || !to) return { ok: false, message: "Custom range requires both from and to dates." };
  const start = istStartOfDay(from);
  const end = istEndOfDay(to);
  if (!start || !end) return { ok: false, message: "Invalid custom date format." };
  if (start.getTime() > end.getTime()) return { ok: false, message: "fromDate must be on or before toDate." };
  if (end.getTime() - start.getTime() > MAX_CUSTOM_WINDOW_MS) {
    return { ok: false, message: "Custom range exceeds the maximum allowed window of 2 years." };
  }
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);
  return { ok: true, window: { start, end, prevStart, prevEnd } };
}

// Same wall-clock moment `months` months away, clamped to that month's last day
// (31 Mar → 28/29 Feb), so "this month so far" maps onto "last month to the same date".
function shiftMonths(d: Date, months: number) {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}

function shiftDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

// The comparison window is the SAME point in the previous period (today so far vs
// yesterday up to this time, this month so far vs last month up to this date), so a
// period that is still running isn't compared against a whole one.
function resolveRange(preset: RangePreset | undefined, now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  let prevStart: Date;
  let prevEnd: Date;

  switch (preset) {
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      prevStart = shiftDays(start, -1);
      prevEnd = shiftDays(end, -1);
      break;
    }
    case "week": {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      end.setTime(now.getTime());
      prevStart = shiftDays(start, -7);
      prevEnd = shiftDays(now, -7);
      break;
    }
    case "month": {
      start.setDate(1);
      end.setTime(now.getTime());
      prevStart = shiftMonths(start, -1);
      prevEnd = shiftMonths(now, -1);
      break;
    }
    case "prevMonth": {
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      prevStart = shiftMonths(start, -1);
      prevEnd = new Date(start.getTime() - 1);
      break;
    }
    case "year": {
      start.setMonth(0, 1);
      end.setTime(now.getTime());
      prevStart = shiftMonths(start, -12);
      prevEnd = shiftMonths(now, -12);
      break;
    }
    case "today":
    default:
      prevStart = shiftDays(start, -1);
      prevEnd = shiftDays(now, -1);
      break;
  }

  return { start, end, prevStart, prevEnd };
}

// null when the previous period had no revenue — a % change from ₹0 is meaningless.
function deltaPct(current: number, previous: number) {
  if (!previous) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function bucketStage(start: Date, end: Date) {
  const spanHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  if (spanHours <= 26) {
    return {
      unit: "hour" as const,
      group: { $hour: { date: "$createdAt", timezone: "Asia/Kolkata" } },
      slots: Array.from({ length: 24 }, (_, i) => i),
    };
  }
  // ⚠ DAYOFMONTH only means anything INSIDE a single month. Past ~31 days it
  // collapses Jan 5 + Feb 5 + Mar 5 … into one slot, so `totalRange=year` charted 31
  // buckets that mixed every month together. Anything longer than a month buckets by
  // MONTH instead; `unit` (already in the response) tells the panel how to label.
  const spanDays = spanHours / 24;
  if (spanDays > 31) {
    return {
      unit: "month" as const,
      group: { $month: { date: "$createdAt", timezone: "Asia/Kolkata" } },
      slots: Array.from({ length: 12 }, (_, i) => i + 1),
    };
  }
  return {
    unit: "day" as const,
    group: { $dayOfMonth: { date: "$createdAt", timezone: "Asia/Kolkata" } },
    slots: null,
  };
}

// GET /api/v1/admin/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const {
      orderRange,
      totalRange,
      fromDate,
      toDate,
      orderFromDate,
      orderToDate,
      totalFromDate,
      totalToDate,
      recentLimit,
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(recentLimit || "7", 10) || 7, 25);
    const now = new Date();

    let orderWindow: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
    if (orderRange === "custom") {
      const oFrom = orderFromDate || fromDate;
      const oTo = orderToDate || toDate;
      const r = resolveCustom(oFrom, oTo);
      if (!r.ok) {
        return res.status(400).json({ success: false, message: `orderReports: ${r.message}` });
      }
      orderWindow = r.window;
    } else if (!orderRange && (orderFromDate || orderToDate || fromDate || toDate)) {
      // Legacy: bare fromDate/toDate without an explicit range — treat as custom for Order Reports.
      const r = resolveCustom(orderFromDate || fromDate, orderToDate || toDate);
      if (!r.ok) {
        return res.status(400).json({ success: false, message: `orderReports: ${r.message}` });
      }
      orderWindow = r.window;
    } else {
      orderWindow = resolveRange((orderRange as RangePreset) || "today", now);
    }

    let totalWindow: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
    if (totalRange === "custom") {
      const tFrom = totalFromDate || fromDate;
      const tTo = totalToDate || toDate;
      const r = resolveCustom(tFrom, tTo);
      if (!r.ok) {
        return res.status(400).json({ success: false, message: `totalOrderReports: ${r.message}` });
      }
      totalWindow = r.window;
    } else {
      totalWindow = resolveRange((totalRange as RangePreset) || "today", now);
    }

    const bucket = bucketStage(totalWindow.start, totalWindow.end);

    const d = await adminDashSql.fetchDashboardData({ orderWindow, totalWindow, unit: bucket.unit, limit });
      // Time-series: merge per-bucket across product types, then lay out on slots.
      const seriesMap = new Map<number, { orders: number; earnings: number }>();
      for (const row of d.series) {
        const prev = seriesMap.get(row.slot) || { orders: 0, earnings: 0 };
        seriesMap.set(row.slot, { orders: prev.orders + row.orders, earnings: prev.earnings + row.earnings });
      }
      const slots = bucket.slots ?? Array.from(seriesMap.keys()).sort((a, b) => a - b);
      const series = slots.map((slot) => ({ bucket: String(slot).padStart(2, "0"), orders: seriesMap.get(slot)?.orders || 0, earnings: seriesMap.get(slot)?.earnings || 0 }));
      return res.status(200).json({
        success: true,
        data: {
          orderReports: {
            range: orderRange || (orderFromDate || orderToDate || fromDate || toDate ? "custom" : "today"),
            windowStart: orderWindow.start, windowEnd: orderWindow.end,
            prevWindowStart: orderWindow.prevStart, prevWindowEnd: orderWindow.prevEnd,
            package: { amount: d.revenue.pkg.revenue, count: d.revenue.pkg.count, prevAmount: d.revenue.pkgPrev, deltaPct: deltaPct(d.revenue.pkg.revenue, d.revenue.pkgPrev) },
            course: { amount: d.revenue.course.revenue, count: d.revenue.course.count, prevAmount: d.revenue.coursePrev, deltaPct: deltaPct(d.revenue.course.revenue, d.revenue.coursePrev) },
            ebook: { amount: d.revenue.ebook.revenue, count: d.revenue.ebook.count, prevAmount: d.revenue.ebookPrev, deltaPct: deltaPct(d.revenue.ebook.revenue, d.revenue.ebookPrev) },
            book: { amount: d.revenue.book.revenue, count: d.revenue.book.count, prevAmount: d.revenue.bookPrev, deltaPct: deltaPct(d.revenue.book.revenue, d.revenue.bookPrev) },
            testSeries: { amount: d.revenue.testSeries.revenue, count: d.revenue.testSeries.count, prevAmount: d.revenue.testSeriesPrev, deltaPct: deltaPct(d.revenue.testSeries.revenue, d.revenue.testSeriesPrev) },
            liveCourse: { amount: d.revenue.liveCourse.revenue, count: d.revenue.liveCourse.count, prevAmount: d.revenue.liveCoursePrev, deltaPct: deltaPct(d.revenue.liveCourse.revenue, d.revenue.liveCoursePrev) },
          },
          totalOrderReports: { range: totalRange || "today", windowStart: totalWindow.start, windowEnd: totalWindow.end, unit: bucket.unit, totalOrders: d.totals.orders, totalEarnings: d.totals.earnings, series },
          recentPackageSubscriptions: d.recentPackageSubs,
          recentCourseSubscriptions: d.recentCourseSubs,
          recentBookOrders: d.recentBookOrders,
          recentEbookSubscriptions: d.recentEbookSubs,
          recentTestSeriesSubscriptions: d.recentTestSeriesSubs,
          recentLiveCourseSubscriptions: d.recentLiveCourseSubs,
          summary: d.summary,
        },
      });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/dashboard/trending?days=7|30
// Top sellers per product type over a rolling window ending now. Anything other
// than 30 falls back to 7 so the shared cache only ever holds two entries.
export const getDashboardTrending = async (req: Request, res: Response) => {
  try {
    const days = req.query.days === "30" ? 30 : 7;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const trending = await adminDashSql.fetchTrending(windowStart);
    return res.status(200).json({ success: true, data: { days, windowStart, windowEnd, ...trending } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
