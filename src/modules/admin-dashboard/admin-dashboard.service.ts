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

// ── time-series buckets (HOUR or DAYOFMONTH, IST) ──────────────────────────────
const seriesFor = async (table: string, revenueCol: string, w: Win, unit: "hour" | "day", extraWhere = "") => {
  const fn = unit === "hour" ? "HOUR" : "DAYOFMONTH";
  const rows = await prisma.$queryRawUnsafe<{ slot: number; orders: bigint; earnings: any }[]>(
    `SELECT ${fn}(CONVERT_TZ(created_at,'+00:00','+05:30')) AS slot, COUNT(*) AS orders, COALESCE(SUM(${revenueCol}),0) AS earnings
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
    pkgRev, courseRev, ebookRev, bookRev,
    pkgRevP, courseRevP, ebookRevP, bookRevP,
    totSub, totEbook, totBook,
    pkgSeries, courseSeries, ebookSeries, bookSeries,
    newCustomers, recentPackageSubs, recentCourseSubs, recentBookOrders, recentEbookSubs,
    totalCustomers, activeCustomers, totalCourses, totalPackages, totalEbooks, totalBooks, totalPromoters, totalEducators, pendingOfflineEnquiries, pendingInquiries,
  ] = await Promise.all([
    subRevenue(cur, "package"), subRevenue(cur, "course"), ebookRevenue(cur), bookRevenue(cur),
    subRevenue(prev, "package"), subRevenue(prev, "course"), ebookRevenue(prev), bookRevenue(prev),
    subRevenue(tot, "all"), ebookRevenue(tot), bookRevenue(tot),
    seriesFor("ws_package_course_subscription", "amount", tot, unit, "AND course_id IS NULL"),
    seriesFor("ws_package_course_subscription", "amount", tot, unit, "AND course_id IS NOT NULL"),
    seriesFor("ws_ebook_order", "order_price", tot, unit, "AND status = 'complete'"),
    seriesFor("ws_book_order", "order_price", tot, unit, "AND status = 'verified'"),
    prisma.customer.findMany({ where: { isAccountDeleted: false }, select: { id: true, fullName: true, phoneNumber: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.packageCourseSubscription.findMany({ where: { courseId: null }, include: { package: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.packageCourseSubscription.findMany({ where: { courseId: { not: null } }, include: { course: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.bookOrder.findMany({ select: { id: true, receiptId: true, amount: true, status: true, createdAt: true, orderItems: true }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.eBookSubscription.findMany({ include: { eBook: { select: { id: true, name: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.customer.count({ where: { isAccountDeleted: false } }),
    prisma.customer.count({ where: { isAccountDeleted: false, status: true } }),
    prisma.course.count({ where: { status: true } }),
    prisma.package.count({ where: { active: true } }),
    prisma.eBook.count({ where: { active: true } }),
    prisma.book.count({ where: { active: true } }),
    prisma.promoter.count({ where: { status: true } }),
    prisma.courseEducator.count({ where: { status: true } }),
    prisma.offlineEnquiry.count({}),
    prisma.inquiry.count({}),
  ]);

  return {
    revenue: {
      pkg: pkgRev, course: courseRev, ebook: ebookRev, book: bookRev,
      pkgPrev: pkgRevP.revenue, coursePrev: courseRevP.revenue, ebookPrev: ebookRevP.revenue, bookPrev: bookRevP.revenue,
    },
    totals: { orders: totSub.count + totEbook.count + totBook.count, earnings: totSub.revenue + totEbook.revenue + totBook.revenue },
    series: [...pkgSeries, ...courseSeries, ...ebookSeries, ...bookSeries],
    newCustomers, recentPackageSubs, recentCourseSubs, recentBookOrders, recentEbookSubs,
    summary: {
      customers: { total: totalCustomers, active: activeCustomers },
      catalog: { courses: totalCourses, packages: totalPackages, ebooks: totalEbooks, books: totalBooks },
      team: { promoters: totalPromoters, educators: totalEducators },
      enquiries: { offline: pendingOfflineEnquiries, website: pendingInquiries },
    },
  };
};
