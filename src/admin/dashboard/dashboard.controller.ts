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

// The comparison window is the WHOLE previous period (today vs all of yesterday, this
// month vs all of last month), so deltaPct compares the amounts the cards show.
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
      // Monday-start week, like the old Laravel dashboard (Carbon startOfWeek).
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
      end.setTime(now.getTime());
      prevStart = shiftDays(start, -7);
      prevEnd = new Date(start.getTime() - 1);
      break;
    }
    case "month": {
      start.setDate(1);
      end.setTime(now.getTime());
      prevStart = shiftMonths(start, -1);
      prevEnd = new Date(start.getTime() - 1);
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
      prevEnd = new Date(start.getTime() - 1);
      break;
    }
    case "today":
    default:
      prevStart = shiftDays(start, -1);
      prevEnd = new Date(start.getTime() - 1);
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

type DashboardWindow = { start: Date; end: Date; prevStart: Date; prevEnd: Date };

function resolveDashboardWindow(q: Record<string, string | undefined>, now = new Date()):
  | { ok: true; range: string; window: DashboardWindow }
  | { ok: false; message: string } {
  const range = q.range || q.orderRange || q.totalRange;
  const from = q.fromDate || q.orderFromDate || q.totalFromDate;
  const to = q.toDate || q.orderToDate || q.totalToDate;
  if (range === "custom" || (!range && (from || to))) {
    const custom = resolveCustom(from, to);
    return custom.ok ? { ok: true, range: "custom", window: custom.window } : custom;
  }
  return { ok: true, range: range || "today", window: resolveRange(range as RangePreset | undefined, now) };
}

// GET /api/v1/admin/dashboard?range=&fromDate=&toDate=
// One date filter drives the order cards, the chart and the recent lists.
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string>;
    const limit = Math.min(parseInt(query.recentLimit || "7", 10) || 7, 25);
    const resolved = resolveDashboardWindow(query);
    if (!resolved.ok) {
      return res.status(400).json({ success: false, message: resolved.message });
    }
    const { range, window } = resolved;

    const bucket = bucketStage(window.start, window.end);

    const d = await adminDashSql.fetchDashboardData({ window, unit: bucket.unit, limit });
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
            range,
            windowStart: window.start, windowEnd: window.end,
            prevWindowStart: window.prevStart, prevWindowEnd: window.prevEnd,
            package: { amount: d.revenue.pkg.revenue, count: d.revenue.pkg.count, prevAmount: d.revenue.pkgPrev, deltaPct: deltaPct(d.revenue.pkg.revenue, d.revenue.pkgPrev) },
            course: { amount: d.revenue.course.revenue, count: d.revenue.course.count, prevAmount: d.revenue.coursePrev, deltaPct: deltaPct(d.revenue.course.revenue, d.revenue.coursePrev) },
            ebook: { amount: d.revenue.ebook.revenue, count: d.revenue.ebook.count, prevAmount: d.revenue.ebookPrev, deltaPct: deltaPct(d.revenue.ebook.revenue, d.revenue.ebookPrev) },
            book: { amount: d.revenue.book.revenue, count: d.revenue.book.count, prevAmount: d.revenue.bookPrev, deltaPct: deltaPct(d.revenue.book.revenue, d.revenue.bookPrev) },
            testSeries: { amount: d.revenue.testSeries.revenue, count: d.revenue.testSeries.count, prevAmount: d.revenue.testSeriesPrev, deltaPct: deltaPct(d.revenue.testSeries.revenue, d.revenue.testSeriesPrev) },
            liveCourse: { amount: d.revenue.liveCourse.revenue, count: d.revenue.liveCourse.count, prevAmount: d.revenue.liveCoursePrev, deltaPct: deltaPct(d.revenue.liveCourse.revenue, d.revenue.liveCoursePrev) },
          },
          totalOrderReports: { range, windowStart: window.start, windowEnd: window.end, unit: bucket.unit, totalOrders: d.totals.orders, totalEarnings: d.totals.earnings, series },
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

const ACTIVITY_TYPES: adminDashSql.ActivityType[] = ["package", "course", "book", "ebook", "testSeries", "liveCourse"];
const MAX_ACTIVITY_PAGE = 50;

// type + offset/limit for the Activity cards' paginated tabs; null on an unknown type.
function activityPage(req: Request) {
  const type = req.query.type as adminDashSql.ActivityType;
  if (!ACTIVITY_TYPES.includes(type)) return null;
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10), MAX_ACTIVITY_PAGE);
  return { type, offset, limit };
}

// GET /api/v1/admin/dashboard/trending?type=&offset=&limit=&range=&fromDate=&toDate=
// Top sellers per product type inside the dashboard's date filter.
export const getDashboardTrending = async (req: Request, res: Response) => {
  const pageReq = activityPage(req);
  if (!pageReq) return res.status(400).json({ success: false, message: `type must be one of: ${ACTIVITY_TYPES.join(", ")}` });
  const resolved = resolveDashboardWindow(req.query as Record<string, string>);
  if (!resolved.ok) return res.status(400).json({ success: false, message: resolved.message });
  const { type, offset, limit } = pageReq;
  const { range, window } = resolved;
  try {
    const page = await adminDashSql.fetchTrending(window, type, offset, limit);
    return res.status(200).json({ success: true, data: { range, type, windowStart: window.start, windowEnd: window.end, offset, limit, ...page } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/dashboard/recent?type=&offset=&limit=&range=&fromDate=&toDate=
// Next pages of an Activity card's recent list (the dashboard payload has page one).
export const getDashboardRecent = async (req: Request, res: Response) => {
  const page = activityPage(req);
  if (!page) return res.status(400).json({ success: false, message: `type must be one of: ${ACTIVITY_TYPES.join(", ")}` });
  const resolved = resolveDashboardWindow(req.query as Record<string, string>);
  if (!resolved.ok) return res.status(400).json({ success: false, message: resolved.message });
  const { range, window } = resolved;
  try {
    const items = await adminDashSql.fetchRecent(page.type, window, page.offset, page.limit + 1);
    return res.status(200).json({
      success: true,
      data: {
        range, windowStart: window.start, windowEnd: window.end,
        type: page.type, offset: page.offset, limit: page.limit,
        items: items.slice(0, page.limit), hasMore: items.length > page.limit,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
