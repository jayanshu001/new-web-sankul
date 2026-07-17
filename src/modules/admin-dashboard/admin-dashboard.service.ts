/**
 * Admin dashboard — SQL data layer for GET /admin/dashboard. Gated behind
 * `isMysqlModule("admin-dashboard")`. The controller keeps the (DB-agnostic)
 * window/range/bucket resolution; this returns the same revenue cards, totals,
 * time-series, recent lists and counters from SQL.
 *
 * Field drift: Mongo PackageCourseSubscription.paidAmount → SQL `amount`;
 * targetPackageId → packageId. EBookOrder revenue = order_price, status enum
 * "complete". BookOrder revenue = order_price (amount), status "verified",
 * items in order_items JSON. Customer is single `fullName` + `phoneNumber`.
 * Time-series buckets via raw SQL HOUR()/DAYOFMONTH() in IST (CONVERT_TZ).
 */
import { prisma } from "../../config/prisma";
import * as dashTransformer from "./admin-dashboard.transformer";

export const isAdminDashboardMysql = (): boolean => true;

type Win = { start: Date; end: Date };
const num = (v: any) => (v == null ? 0 : Number(v));

// ── revenue + count for a window ───────────────────────────────────────────────
const subRevenue = async (w: Win, courseScope: "course" | "package" | "all") => {
  const where: any = { createdAt: { gte: w.start, lte: w.end } };
  if (courseScope === "course") where.courseId = { not: null };
  else if (courseScope === "package") where.courseId = null;
  const agg = await prisma.packageCourseSubscription.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
const ebookRevenue = async (w: Win) => {
  const agg = await prisma.eBookOrder.aggregate({ where: { createdAt: { gte: w.start, lte: w.end }, status: "complete" as any }, _sum: { orderPrice: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.orderPrice), count: agg._count._all };
};
const bookRevenue = async (w: Win) => {
  const agg = await prisma.bookOrder.aggregate({ where: { createdAt: { gte: w.start, lte: w.end }, status: "verified" }, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
// Test-series subscription rows are created ONLY on verify (pending state lives on
// ws_test_series_order), so every row is a paid purchase — no status filter, sum price.
const testSeriesRevenue = async (w: Win) => {
  const agg = await prisma.testSeriesSubscription.aggregate({ where: { createdAt: { gte: w.start, lte: w.end } }, _sum: { price: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.price), count: agg._count._all };
};
// Live-course is single-table (pending + folded rows coexist), so restrict to
// payment_status='verified' to count only real paid money — sum paid_amount.
const liveCourseRevenue = async (w: Win) => {
  const agg = await prisma.liveCourseSubscription.aggregate({ where: { createdAt: { gte: w.start, lte: w.end }, paymentStatus: "verified" }, _sum: { paidAmount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.paidAmount), count: agg._count._all };
};

// ── time-series buckets (HOUR or DAYOFMONTH, IST) ──────────────────────────────
const seriesFor = async (table: string, revenueCol: string, w: Win, unit: "hour" | "day", extraWhere = "") => {
  const fn = unit === "hour" ? "HOUR" : "DAYOFMONTH";
  const rows = await prisma.$queryRawUnsafe<{ slot: number; orders: bigint; earnings: any }[]>(
    // created_at is stored as IST wall-clock (see config/prisma.ts IST shift), so
    // HOUR()/DAYOFMONTH() on the raw column already yields the IST bucket — no
    // CONVERT_TZ needed. The `?` bounds (UTC Dates) are auto-shifted +5:30 to IST
    // by the Prisma raw-query middleware, so they still match.
    `SELECT ${fn}(created_at) AS slot, COUNT(*) AS orders, COALESCE(SUM(${revenueCol}),0) AS earnings
     FROM ${table}
     WHERE created_at >= ? AND created_at <= ? ${extraWhere}
     GROUP BY slot`,
    w.start, w.end
  );
  return rows.map((r) => ({ slot: Number(r.slot), orders: Number(r.orders), earnings: num(r.earnings) }));
};

export const fetchDashboardData = async (opts: {
  orderWindow: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
  totalWindow: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
  unit: "hour" | "day";
  limit: number;
}) => {
  const { orderWindow: ow, totalWindow: tw, unit, limit } = opts;
  const cur: Win = { start: ow.start, end: ow.end };
  const prev: Win = { start: ow.prevStart, end: ow.prevEnd };
  const tot: Win = { start: tw.start, end: tw.end };

  const [
    pkgRev, courseRev, ebookRev, bookRev, tsRev, lcRev,
    pkgRevP, courseRevP, ebookRevP, bookRevP, tsRevP, lcRevP,
    totSub, totEbook, totBook, totTs, totLc,
    pkgSeries, courseSeries, ebookSeries, bookSeries, tsSeries, lcSeries,
    newCustomers, recentPackageSubs, recentCourseSubs, recentBookOrders, recentEbookSubs, recentTestSeriesSubs, recentLiveCourseSubs,
    totalCustomers, activeCustomers, totalCourses, totalPackages, totalEbooks, totalBooks, totalTestSeries, totalLiveCourses, totalPromoters, totalEducators, pendingOfflineEnquiries, pendingInquiries,
  ] = await Promise.all([
    subRevenue(cur, "package"), subRevenue(cur, "course"), ebookRevenue(cur), bookRevenue(cur), testSeriesRevenue(cur), liveCourseRevenue(cur),
    subRevenue(prev, "package"), subRevenue(prev, "course"), ebookRevenue(prev), bookRevenue(prev), testSeriesRevenue(prev), liveCourseRevenue(prev),
    subRevenue(tot, "all"), ebookRevenue(tot), bookRevenue(tot), testSeriesRevenue(tot), liveCourseRevenue(tot),
    seriesFor("ws_package_course_subscription", "amount", tot, unit, "AND course_id IS NULL"),
    seriesFor("ws_package_course_subscription", "amount", tot, unit, "AND course_id IS NOT NULL"),
    seriesFor("ws_ebook_order", "order_price", tot, unit, "AND status = 'complete'"),
    seriesFor("ws_book_order", "order_price", tot, unit, "AND status = 'verified'"),
    seriesFor("ws_test_series_subscription", "price", tot, unit),
    seriesFor("ws_live_course_subscription", "paid_amount", tot, unit, "AND payment_status = 'verified'"),
    prisma.customer.findMany({ where: { isAccountDeleted: false }, select: { id: true, fullName: true, phoneNumber: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.packageCourseSubscription.findMany({ where: { courseId: null }, include: { package: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.packageCourseSubscription.findMany({ where: { courseId: { not: null } }, include: { course: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.bookOrder.findMany({ select: { id: true, receiptId: true, amount: true, status: true, createdAt: true, orderItems: true }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.eBookSubscription.findMany({ include: { eBook: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    // TestSeries/LiveCourse subscription models carry only scalar FKs (no Prisma
    // relations) — refs are batch-loaded below.
    prisma.testSeriesSubscription.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    prisma.liveCourseSubscription.findMany({ where: { paymentStatus: "verified" }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.customer.count({ where: { isAccountDeleted: false } }),
    prisma.customer.count({ where: { isAccountDeleted: false, status: true } }),
    prisma.course.count({ where: { status: true } }),
    prisma.package.count({ where: { active: true } }),
    prisma.eBook.count({ where: { active: true } }),
    prisma.book.count({ where: { active: true } }),
    prisma.testSeries.count({ where: { status: true } }),
    prisma.liveCourse.count({ where: { status: true } }),
    prisma.promoter.count({ where: { status: true } }),
    prisma.courseEducator.count({ where: { status: true } }),
    prisma.offlineEnquiry.count({}),
    prisma.inquiry.count({}),
  ]);

  // ── test-series + live-course recents: batch-load customer + catalog refs ──────
  const custIds = [...new Set([...recentTestSeriesSubs, ...recentLiveCourseSubs].map((s) => s.customerId).filter((x): x is number => x != null))];
  const custRows = custIds.length ? await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, fullName: true, phoneNumber: true } }) : [];
  const custMap = new Map(custRows.map((c) => [c.id, c]));
  const tsIds = [...new Set(recentTestSeriesSubs.map((s) => s.testSeriesId).filter((x): x is number => x != null))];
  const tsRows = tsIds.length ? await prisma.testSeries.findMany({ where: { id: { in: tsIds } }, select: { id: true, title: true, thumbnail: true } }) : [];
  const tsMap = new Map(tsRows.map((t) => [t.id, t]));
  const lcIds = [...new Set(recentLiveCourseSubs.map((s) => s.liveCourseId).filter((x): x is number => x != null))];
  const lcRows = lcIds.length ? await prisma.liveCourse.findMany({ where: { id: { in: lcIds } }, select: { id: true, name: true, image: true } }) : [];
  const lcMap = new Map(lcRows.map((l) => [l.id, l]));

  // ── recent book orders: resolve line items (child rows preferred, else JSON)
  //    then batch-load referenced books to populate name/image on items[].bookId.
  const childRows = await prisma.bookOrderItem.findMany({
    where: { order_id: { in: recentBookOrders.map((o) => o.receiptId) } },
    include: { Book: { select: { name: true } } },
  });
  const childByReceipt = new Map<string, any[]>();
  for (const it of childRows) {
    const arr = childByReceipt.get(it.order_id) ?? [];
    arr.push(it);
    childByReceipt.set(it.order_id, arr);
  }
  const bookItemsByOrder = new Map<number, ReturnType<typeof dashTransformer.itemsFromJson>>();
  for (const o of recentBookOrders) {
    const child = childByReceipt.get(o.receiptId);
    bookItemsByOrder.set(
      o.id,
      child?.length ? dashTransformer.itemsFromChildRows(child) : dashTransformer.itemsFromJson(o.orderItems)
    );
  }
  const bookIds = [...new Set([...bookItemsByOrder.values()].flat().map((i) => i.bookId).filter((id): id is number => id != null))];
  const bookRows = bookIds.length
    ? await prisma.book.findMany({ where: { id: { in: bookIds } }, select: { id: true, name: true, image: true } })
    : [];
  const bookMap = new Map(bookRows.map((b) => [b.id, b]));

  return {
    revenue: {
      pkg: pkgRev, course: courseRev, ebook: ebookRev, book: bookRev, testSeries: tsRev, liveCourse: lcRev,
      pkgPrev: pkgRevP.revenue, coursePrev: courseRevP.revenue, ebookPrev: ebookRevP.revenue, bookPrev: bookRevP.revenue,
      testSeriesPrev: tsRevP.revenue, liveCoursePrev: lcRevP.revenue,
    },
    // Total Order Reports chart folds ALL six paid categories so the aggregate stays
    // consistent with the per-category cards (test-series + live-course included).
    totals: {
      orders: totSub.count + totEbook.count + totBook.count + totTs.count + totLc.count,
      earnings: totSub.revenue + totEbook.revenue + totBook.revenue + totTs.revenue + totLc.revenue,
    },
    series: [...pkgSeries, ...courseSeries, ...ebookSeries, ...bookSeries, ...tsSeries, ...lcSeries],
    newCustomers,
    recentPackageSubs: recentPackageSubs.map(dashTransformer.toPackageSubDto),
    recentCourseSubs: recentCourseSubs.map(dashTransformer.toCourseSubDto),
    recentBookOrders: recentBookOrders.map((o) =>
      dashTransformer.toBookOrderDto(o, bookItemsByOrder.get(o.id) ?? [], bookMap)
    ),
    recentEbookSubs: recentEbookSubs.map(dashTransformer.toEbookSubDto),
    recentTestSeriesSubs: recentTestSeriesSubs.map((s) => dashTransformer.toTestSeriesSubDto(s, custMap, tsMap)),
    recentLiveCourseSubs: recentLiveCourseSubs.map((s) => dashTransformer.toLiveCourseSubDto(s, custMap, lcMap)),
    summary: {
      customers: { total: totalCustomers, active: activeCustomers },
      catalog: { courses: totalCourses, packages: totalPackages, ebooks: totalEbooks, books: totalBooks, testSeries: totalTestSeries, liveCourses: totalLiveCourses },
      team: { promoters: totalPromoters, educators: totalEducators },
      enquiries: { offline: pendingOfflineEnquiries, website: pendingInquiries },
    },
  };
};
