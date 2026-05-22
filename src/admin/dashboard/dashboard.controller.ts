import { Request, Response } from "express";
import { Customer } from "../../models/customer/Customer.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Book } from "../../models/book/Book.model";
import { Promoter } from "../../models/promoter/Promoter.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { OfflineEnquiry } from "../../models/offline/OfflineEnquiry.model";
import { Inquiry } from "../../models/system/Inquiry.model";
import { PackageCourseEbookOrderStatus } from "../../models/enums";

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

function resolveRange(preset: RangePreset | undefined, now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  switch (preset) {
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    }
    case "week": {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      end.setTime(now.getTime());
      break;
    }
    case "month": {
      start.setDate(1);
      end.setTime(now.getTime());
      break;
    }
    case "prevMonth": {
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "year": {
      start.setMonth(0, 1);
      end.setTime(now.getTime());
      break;
    }
    case "today":
    default:
      break;
  }

  const prevStart = new Date(start);
  const prevEnd = new Date(end);
  const span = end.getTime() - start.getTime();
  prevStart.setTime(start.getTime() - span - 1);
  prevEnd.setTime(start.getTime() - 1);

  return { start, end, prevStart, prevEnd };
}

function deltaPct(current: number, previous: number) {
  if (!previous) return current > 0 ? 100 : 0;
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

    const orderMatch = { createdAt: { $gte: orderWindow.start, $lte: orderWindow.end } };
    const orderPrevMatch = { createdAt: { $gte: orderWindow.prevStart, $lte: orderWindow.prevEnd } };
    const totalMatch = { createdAt: { $gte: totalWindow.start, $lte: totalWindow.end } };

    const completeStatus = PackageCourseEbookOrderStatus.COMPLETE;
    const bookVerified = "verified";

    const bucket = bucketStage(totalWindow.start, totalWindow.end);

    const [
      // Order Reports cards (current window)
      packageRevenueAgg,
      courseRevenueAgg,
      ebookRevenueAgg,
      bookRevenueAgg,
      // Order Reports cards (previous window for delta %)
      packageRevenuePrevAgg,
      courseRevenuePrevAgg,
      ebookRevenuePrevAgg,
      bookRevenuePrevAgg,
      // Total Order Reports widget
      totalOrdersAgg,
      // Hourly/daily growth series for chart
      packageSeries,
      courseSeries,
      ebookSeries,
      bookSeries,
      // Lists
      newCustomers,
      recentPackageSubs,
      recentCourseSubs,
      recentBookOrders,
      recentEbookSubs,
      // Counters
      totalCustomers,
      activeCustomers,
      totalCourses,
      totalPackages,
      totalEbooks,
      totalBooks,
      totalPromoters,
      totalEducators,
      pendingOfflineEnquiries,
      pendingInquiries,
    ] = await Promise.all([
      PackageCourseSubscription.aggregate([
        { $match: { ...orderMatch, courseId: null } },
        { $group: { _id: null, revenue: { $sum: "$paidAmount" }, count: { $sum: 1 } } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: { ...orderMatch, courseId: { $ne: null } } },
        { $group: { _id: null, revenue: { $sum: "$paidAmount" }, count: { $sum: 1 } } },
      ]),
      EbookOrder.aggregate([
        { $match: { ...orderMatch, status: completeStatus } },
        { $group: { _id: null, revenue: { $sum: "$orderPrice" }, count: { $sum: 1 } } },
      ]),
      BookOrder.aggregate([
        { $match: { ...orderMatch, status: bookVerified } },
        { $group: { _id: null, revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),

      PackageCourseSubscription.aggregate([
        { $match: { ...orderPrevMatch, courseId: null } },
        { $group: { _id: null, revenue: { $sum: "$paidAmount" } } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: { ...orderPrevMatch, courseId: { $ne: null } } },
        { $group: { _id: null, revenue: { $sum: "$paidAmount" } } },
      ]),
      EbookOrder.aggregate([
        { $match: { ...orderPrevMatch, status: completeStatus } },
        { $group: { _id: null, revenue: { $sum: "$orderPrice" } } },
      ]),
      BookOrder.aggregate([
        { $match: { ...orderPrevMatch, status: bookVerified } },
        { $group: { _id: null, revenue: { $sum: "$amount" } } },
      ]),

      Promise.all([
        PackageCourseSubscription.aggregate([
          { $match: totalMatch },
          { $group: { _id: null, revenue: { $sum: "$paidAmount" }, count: { $sum: 1 } } },
        ]),
        EbookOrder.aggregate([
          { $match: { ...totalMatch, status: completeStatus } },
          { $group: { _id: null, revenue: { $sum: "$orderPrice" }, count: { $sum: 1 } } },
        ]),
        BookOrder.aggregate([
          { $match: { ...totalMatch, status: bookVerified } },
          { $group: { _id: null, revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),
      ]),

      PackageCourseSubscription.aggregate([
        { $match: { ...totalMatch, courseId: null } },
        { $group: { _id: bucket.group, orders: { $sum: 1 }, earnings: { $sum: "$paidAmount" } } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: { ...totalMatch, courseId: { $ne: null } } },
        { $group: { _id: bucket.group, orders: { $sum: 1 }, earnings: { $sum: "$paidAmount" } } },
      ]),
      EbookOrder.aggregate([
        { $match: { ...totalMatch, status: completeStatus } },
        { $group: { _id: bucket.group, orders: { $sum: 1 }, earnings: { $sum: "$orderPrice" } } },
      ]),
      BookOrder.aggregate([
        { $match: { ...totalMatch, status: bookVerified } },
        { $group: { _id: bucket.group, orders: { $sum: 1 }, earnings: { $sum: "$amount" } } },
      ]),

      Customer.find({ isAccountDeleted: false })
        .select("firstName lastName phoneNumber profileImage createdAt")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      PackageCourseSubscription.find({ courseId: null })
        .populate({ path: "targetPackageId", model: Package, select: "name image" })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      PackageCourseSubscription.find({ courseId: { $ne: null } })
        .populate({ path: "courseId", model: Course, select: "name image thumbnail" })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      BookOrder.find({})
        .select("receiptId amount status createdAt items")
        .populate({ path: "items.bookId", model: Book, select: "name image thumbnail" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      EbookSubscription.find({})
        .populate({ path: "ebookId", model: Ebook, select: "name image" })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),

      Customer.countDocuments({ isAccountDeleted: false }),
      Customer.countDocuments({ isAccountDeleted: false, status: true }),
      Course.countDocuments({ status: true }),
      Package.countDocuments({ active: true }),
      Ebook.countDocuments({ status: true }),
      Book.countDocuments({ status: true }),
      Promoter.countDocuments({ isDelete: false, status: true }),
      CourseEducator.countDocuments({ status: true }),
      OfflineEnquiry.countDocuments({}),
      Inquiry.countDocuments({}),
    ]);

    const pkgRev = packageRevenueAgg[0]?.revenue || 0;
    const courseRev = courseRevenueAgg[0]?.revenue || 0;
    const ebookRev = ebookRevenueAgg[0]?.revenue || 0;
    const bookRev = bookRevenueAgg[0]?.revenue || 0;

    const pkgRevPrev = packageRevenuePrevAgg[0]?.revenue || 0;
    const courseRevPrev = courseRevenuePrevAgg[0]?.revenue || 0;
    const ebookRevPrev = ebookRevenuePrevAgg[0]?.revenue || 0;
    const bookRevPrev = bookRevenuePrevAgg[0]?.revenue || 0;

    const [totSubAgg, totEbookAgg, totBookAgg] = totalOrdersAgg as any[];
    const totalOrders =
      (totSubAgg[0]?.count || 0) + (totEbookAgg[0]?.count || 0) + (totBookAgg[0]?.count || 0);
    const totalEarnings =
      (totSubAgg[0]?.revenue || 0) + (totEbookAgg[0]?.revenue || 0) + (totBookAgg[0]?.revenue || 0);

    const seriesMap = new Map<number, { orders: number; earnings: number }>();
    for (const row of [...packageSeries, ...courseSeries, ...ebookSeries, ...bookSeries]) {
      const k = row._id as number;
      const prev = seriesMap.get(k) || { orders: 0, earnings: 0 };
      seriesMap.set(k, {
        orders: prev.orders + (row.orders || 0),
        earnings: prev.earnings + (row.earnings || 0),
      });
    }
    const slots = bucket.slots ?? Array.from(seriesMap.keys()).sort((a, b) => a - b);
    const series = slots.map((slot) => ({
      bucket: String(slot).padStart(2, "0"),
      orders: seriesMap.get(slot)?.orders || 0,
      earnings: seriesMap.get(slot)?.earnings || 0,
    }));

    return res.status(200).json({
      success: true,
      data: {
        orderReports: {
          range:
            orderRange ||
            (orderFromDate || orderToDate || fromDate || toDate ? "custom" : "today"),
          windowStart: orderWindow.start,
          windowEnd: orderWindow.end,
          package: { amount: pkgRev, deltaPct: deltaPct(pkgRev, pkgRevPrev) },
          course: { amount: courseRev, deltaPct: deltaPct(courseRev, courseRevPrev) },
          ebook: { amount: ebookRev, deltaPct: deltaPct(ebookRev, ebookRevPrev) },
          book: { amount: bookRev, deltaPct: deltaPct(bookRev, bookRevPrev) },
        },
        totalOrderReports: {
          range: totalRange || "today",
          windowStart: totalWindow.start,
          windowEnd: totalWindow.end,
          unit: bucket.unit,
          totalOrders,
          totalEarnings,
          series,
        },
        newCustomers,
        recentPackageSubscriptions: recentPackageSubs,
        recentCourseSubscriptions: recentCourseSubs,
        recentBookOrders,
        recentEbookSubscriptions: recentEbookSubs,
        summary: {
          customers: { total: totalCustomers, active: activeCustomers },
          catalog: { courses: totalCourses, packages: totalPackages, ebooks: totalEbooks, books: totalBooks },
          team: { promoters: totalPromoters, educators: totalEducators },
          enquiries: { offline: pendingOfflineEnquiries, website: pendingInquiries },
        },
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
