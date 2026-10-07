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
import { istDay } from "../../libs/customerActivity";


type Win = { start: Date; end: Date };
export type BucketUnit = "hour" | "day" | "month";
const num = (v: any) => (v == null ? 0 : Number(v));

// ── revenue + count for a window ───────────────────────────────────────────────
// Old Laravel dashboard rule: a subscription counts only when its ORDER is complete,
// dated by the order's created_at (Subscription JOIN ws_package_course_order).
const subRevenue = async (w: Win, courseScope: "course" | "package" | "all") => {
  const where: any = { packageCourseOrder: { status: "complete", createdAt: { gte: w.start, lte: w.end } } };
  // Same split as the Subscription Report's type filter (admin-subscription buildCourseSubBaseWhere).
  if (courseScope === "course") where.courseId = { gt: 0 };
  else if (courseScope === "package") { where.courseId = null; where.packageId = { gt: 0 }; }
  const agg = await prisma.packageCourseSubscription.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
// Old Laravel dashboard query: completed ebook orders, SUM(order_price).
const ebookRevenue = async (w: Win) => {
  const agg = await prisma.eBookOrder.aggregate({ where: { createdAt: { gte: w.start, lte: w.end }, status: "complete" as any }, _sum: { orderPrice: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.orderPrice), count: agg._count._all };
};

const bookRevenue = async (w: Win) => {
  const agg = await prisma.bookOrder.aggregate({ where: { createdAt: { gte: w.start, lte: w.end }, status: "verified" }, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
// RAW SQL — column names are strings, so `yarn typecheck` cannot catch a rename.
// ws_test_series_order / ws_live_course_order have the ws_package_course_order shape,
// so they take the package/course rule: a subscription counts only when its ORDER is
// complete, dated by the order's created_at, ₹ = the order's charged `discount_price`.
const paidSubRevenue = async (w: Win, subTable: string, orderTable: string) => {
  const [r] = await prisma.$queryRawUnsafe<{ orders: bigint; revenue: any }[]>(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.discount_price),0) AS revenue
     FROM ${subTable} s JOIN ${orderTable} o ON o.id = s.order_id
     WHERE o.status = 'complete' AND o.created_at >= ? AND o.created_at <= ?`,
    w.start, w.end
  );
  return { revenue: num(r?.revenue), count: Number(r?.orders ?? 0) };
};
const testSeriesRevenue = (w: Win) => paidSubRevenue(w, "ws_test_series_subscription", "ws_test_series_order");
// Live course: each purchase (renewals included) is its own order since 2026-08-25.
// `discount_price` is the charged amount (was paid_amount until 2026-08-27).
const liveCourseRevenue = (w: Win) => paidSubRevenue(w, "ws_live_course_subscription", "ws_live_course_order");

// ── time-series buckets (HOUR / DAYOFMONTH / MONTH, IST) ──────────────────────
/**
 * ⚠ DAYOFMONTH only makes sense INSIDE one month. Over a year window it collapses
 * Jan 5 + Feb 5 + Mar 5 … into slot 5, so `totalRange=year` was charting 31
 * meaningless buckets built from every row in the range. Ranges longer than a
 * month now bucket by MONTH (1-12); the controller reports which via `unit`, which
 * it already returns.
 */
const seriesFor = async (table: string, revenueCol: string, w: Win, unit: BucketUnit, extraWhere = "") => {
  const fn = unit === "hour" ? "HOUR" : unit === "month" ? "MONTH" : "DAYOFMONTH";
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

// Chart rows for subscription + order products under the card rule: completed order,
// bucketed by the order's created_at. `revenueExpr` matches the card's ₹ column.
const paidSubSeriesFor = async (subTable: string, orderTable: string, revenueExpr: string, w: Win, unit: BucketUnit, scopeWhere = "") => {
  const fn = unit === "hour" ? "HOUR" : unit === "month" ? "MONTH" : "DAYOFMONTH";
  const rows = await prisma.$queryRawUnsafe<{ slot: number; orders: bigint; earnings: any }[]>(
    `SELECT ${fn}(o.created_at) AS slot, COUNT(*) AS orders, COALESCE(SUM(${revenueExpr}),0) AS earnings
     FROM ${subTable} s JOIN ${orderTable} o ON o.id = s.order_id
     WHERE o.status = 'complete' AND o.created_at >= ? AND o.created_at <= ? ${scopeWhere}
     GROUP BY slot`,
    w.start, w.end
  );
  return rows.map((r) => ({ slot: Number(r.slot), orders: Number(r.orders), earnings: num(r.earnings) }));
};

/**
 * The twelve summary counters on ONE connection.
 *
 * They were twelve entries in the big `Promise.all`, so each acquired its own pool
 * connection. Individually they are ~1ms index counts; the problem is the burst.
 * Prisma's default pool is `physical_cpus * 2 + 1` — five connections on a 2-vCPU
 * box — and the dashboard fires ~25 other queries alongside them. Forty concurrent
 * queries against five connections queue in waves, and once one wave is slow the
 * rest wait behind it until `pool_timeout` (10s default) fires:
 * "Timed out fetching a new connection from the connection pool".
 *
 * `$transaction([...])` runs the array sequentially on a SINGLE connection, so this
 * removes eleven connection acquisitions from the burst. Kept on the typed Prisma
 * API rather than one hand-written SQL statement with twelve scalar subqueries:
 * that version needed literal table names and silently broke on `Inquiry`, whose
 * table is `ws_website_inquiry`, not `ws_inquiry`.
 */
const summaryCounters = async () => {
  const [
    totalCustomers, activeCustomers, totalCourses, totalPackages, totalEbooks, totalBooks,
    totalTestSeries, totalLiveCourses, totalPromoters, totalEducators,
    pendingOfflineEnquiries, pendingInquiries,
  ] = await prisma.$transaction([
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
  return {
    totalCustomers, activeCustomers, totalCourses, totalPackages, totalEbooks, totalBooks,
    totalTestSeries, totalLiveCourses, totalPromoters, totalEducators,
    pendingOfflineEnquiries, pendingInquiries,
  };
};

/**
 * Distinct customers who used the app in each window — ws_customer_activity_day holds
 * one row per customer per IST day (written by authenticate.ts). Both counts in one
 * round trip, each a range scan on the (day, customer_id) primary key.
 * null while the table doesn't exist yet, so the dashboard still loads ("—" on the tile).
 */
const activeCustomers = async (cur: Win, prev: Win) => {
  try {
    // Total counts a customer once even if they used several platforms that period;
    // the per-platform counts can therefore add up to more than the total.
    // The previous period is every day strictly before the current one's first IST day,
    // so a window boundary that isn't IST midnight can't put one day in both periods.
    const curFrom = istDay(cur.start);
    const [row] = await prisma.$queryRaw<{ cur: bigint; prev: bigint; android: bigint; ios: bigint; web: bigint }[]>`
      SELECT
        COUNT(DISTINCT CASE WHEN day >= ${curFrom} THEN customer_id END) AS cur,
        COUNT(DISTINCT CASE WHEN day < ${curFrom} THEN customer_id END) AS prev,
        COUNT(DISTINCT CASE WHEN day >= ${curFrom} AND platform = 'android' THEN customer_id END) AS android,
        COUNT(DISTINCT CASE WHEN day >= ${curFrom} AND platform = 'ios' THEN customer_id END) AS ios,
        COUNT(DISTINCT CASE WHEN day >= ${curFrom} AND platform = 'web' THEN customer_id END) AS web
      FROM ws_customer_activity_day
      WHERE day BETWEEN ${istDay(prev.start)} AND ${istDay(cur.end)}`;
    return {
      current: Number(row?.cur ?? 0),
      previous: Number(row?.prev ?? 0),
      byPlatform: { android: Number(row?.android ?? 0), ios: Number(row?.ios ?? 0), web: Number(row?.web ?? 0) },
    };
  } catch {
    return null;
  }
};

/**
 * Customers who registered in each window — deleted accounts excluded, matching
 * summary.customers.total. Both counts on one connection, each a range seek on
 * idx_customer_search (is_account_deleted, created_at, …). Rows with a NULL
 * created_at never match.
 */
const newCustomers = async (cur: Win, prev: Win) => {
  const [current, previous] = await prisma.$transaction([
    prisma.customer.count({ where: { isAccountDeleted: false, createdAt: { gte: cur.start, lte: cur.end } } }),
    prisma.customer.count({ where: { isAccountDeleted: false, createdAt: { gte: prev.start, lte: prev.end } } }),
  ]);
  return { current, previous };
};

// ── recent purchases (Activity cards' "Recent" tab), offset-paginated ─────────
// The dashboard payload carries the first page; GET /admin/dashboard/recent serves
// the rest as the card scrolls. Every list orders by (created_at, id) DESC so offset
// pages never repeat or skip a row when two share a timestamp.
export type ActivityType = "package" | "course" | "book" | "ebook" | "testSeries" | "liveCourse";

const customerRef = { select: { id: true, fullName: true, phoneNumber: true } } as const;
const productRef = { select: { id: true, name: true, image: true } } as const;

const refMaps = async (rows: { customerId?: number | null }[], ids: number[], load: (ids: number[]) => Promise<any[]>) => {
  const custIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null))];
  const [custRows, refRows] = await Promise.all([
    custIds.length ? prisma.customer.findMany({ where: { id: { in: custIds } }, ...customerRef }) : Promise.resolve([]),
    ids.length ? load(ids) : Promise.resolve([]),
  ]);
  return { custMap: new Map(custRows.map((c) => [c.id, c])), refMap: new Map(refRows.map((r: any) => [r.id, r])) };
};

export const fetchRecent = async (type: ActivityType, w: Win, skip: number, take: number): Promise<any[]> => {
  const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const createdAt = { gte: w.start, lte: w.end };
  switch (type) {
    // Old-dashboard rule: only subscriptions whose order is complete.
    case "package":
      return (await prisma.packageCourseSubscription.findMany({ where: { courseId: null, packageId: { gt: 0 }, packageCourseOrder: { status: "complete", createdAt } }, include: { package: productRef, customer: customerRef }, orderBy: order, skip, take }))
        .map(dashTransformer.toPackageSubDto);
    case "course":
      return (await prisma.packageCourseSubscription.findMany({ where: { courseId: { gt: 0 }, packageCourseOrder: { status: "complete", createdAt } }, include: { course: productRef, customer: customerRef }, orderBy: order, skip, take }))
        .map(dashTransformer.toCourseSubDto);
    case "ebook":
      return (await prisma.eBookSubscription.findMany({ where: { createdAt }, include: { eBook: productRef, customer: customerRef }, orderBy: order, skip, take }))
        .map(dashTransformer.toEbookSubDto);
    case "book": {
      // Paid only, like the Book Orders card/report — pending checkouts are not purchases.
      const orders = await prisma.bookOrder.findMany({ where: { status: "verified", createdAt }, select: { id: true, receiptId: true, amount: true, status: true, createdAt: true, orderItems: true }, orderBy: order, skip, take });
      // Line items: child rows preferred, else the order_items JSON; then batch-load books.
      const childRows = orders.length
        ? await prisma.bookOrderItem.findMany({ where: { order_id: { in: orders.map((o) => o.receiptId) } }, include: { Book: { select: { name: true } } } })
        : [];
      const childByReceipt = new Map<string, any[]>();
      for (const it of childRows) childByReceipt.set(it.order_id, [...(childByReceipt.get(it.order_id) ?? []), it]);
      const itemsByOrder = new Map(orders.map((o) => {
        const child = childByReceipt.get(o.receiptId);
        return [o.id, child?.length ? dashTransformer.itemsFromChildRows(child) : dashTransformer.itemsFromJson(o.orderItems)] as const;
      }));
      const bookIds = [...new Set([...itemsByOrder.values()].flat().map((i) => i.bookId).filter((id): id is number => id != null))];
      const bookRows = bookIds.length ? await prisma.book.findMany({ where: { id: { in: bookIds } }, ...productRef }) : [];
      const bookMap = new Map(bookRows.map((b) => [b.id, b]));
      return orders.map((o) => dashTransformer.toBookOrderDto(o, itemsByOrder.get(o.id) ?? [], bookMap));
    }
    case "testSeries": {
      // No Prisma relation to ws_test_series_order, so the completed-order filter is a raw id page.
      const ids = (await prisma.$queryRawUnsafe<{ id: number }[]>(
        `SELECT s.id FROM ws_test_series_subscription s JOIN ws_test_series_order o ON o.id = s.order_id
         WHERE o.status = 'complete' AND o.created_at >= ? AND o.created_at <= ?
         ORDER BY o.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
        w.start, w.end, take, skip
      )).map((r) => Number(r.id));
      if (!ids.length) return [];
      const rank = new Map(ids.map((id, i) => [id, i]));
      const subs = (await prisma.testSeriesSubscription.findMany({ where: { id: { in: ids } } })).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      const { custMap, refMap } = await refMaps(subs, [...new Set(subs.map((r) => r.testSeriesId))],
        (ids) => prisma.testSeries.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, thumbnail: true } }));
      return subs.map((r) => dashTransformer.toTestSeriesSubDto(r, custMap, refMap));
    }
    case "liveCourse": {
      // "Recent purchases" is an ORDER concern — a renewal shows up as its own recent sale.
      const orders = await prisma.liveCourseOrder.findMany({ where: { status: "complete", createdAt }, orderBy: order, skip, take });
      const { custMap, refMap } = await refMaps(orders, [...new Set(orders.map((r) => r.liveCourseId))],
        (ids) => prisma.liveCourse.findMany({ where: { id: { in: ids } }, ...productRef }));
      return orders.map((r) => dashTransformer.toLiveCourseSubDto(r, custMap, refMap));
    }
  }
};

export const fetchDashboardData = async (opts: {
  window: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
  unit: BucketUnit;
  limit: number;
}) => {
  const { window: dw, unit, limit } = opts;
  const cur: Win = { start: dw.start, end: dw.end };
  const prev: Win = { start: dw.prevStart, end: dw.prevEnd };
  const tot = cur;

  const [
    pkgRev, courseRev, ebookRev, bookRev, tsRev, lcRev,
    pkgRevP, courseRevP, ebookRevP, bookRevP, tsRevP, lcRevP,
    pkgSeries, courseSeries, ebookSeries, bookSeries, tsSeries, lcSeries,
    recentPackageSubs, recentCourseSubs, recentBookOrders, recentEbookSubs, recentTestSeriesSubs, recentLiveCourseSubs,
    counters,
    active,
    signups,
  ] = await Promise.all([
    subRevenue(cur, "package"), subRevenue(cur, "course"), ebookRevenue(cur), bookRevenue(cur), testSeriesRevenue(cur), liveCourseRevenue(cur),
    subRevenue(prev, "package"), subRevenue(prev, "course"), ebookRevenue(prev), bookRevenue(prev), testSeriesRevenue(prev), liveCourseRevenue(prev),
    // NOTE: the five `*Revenue(tot)` aggregates that used to sit here are gone. Each
    // scanned exactly the same window, table and filter as its seriesFor() below and
    // then summed it — so the Total Order Reports card was paying for the range twice.
    // `totals` is now folded from the series rows (identical numbers, half the scans,
    // five fewer connections held for the length of a year-range scan).
    paidSubSeriesFor("ws_package_course_subscription", "ws_package_course_order", "s.amount", tot, unit, "AND s.course_id IS NULL AND s.package_id > 0"),
    paidSubSeriesFor("ws_package_course_subscription", "ws_package_course_order", "s.amount", tot, unit, "AND s.course_id > 0"),
    seriesFor("ws_ebook_order", "order_price", tot, unit, "AND status = 'complete'"),
    seriesFor("ws_book_order", "order_price", tot, unit, "AND status = 'verified'"),
    paidSubSeriesFor("ws_test_series_subscription", "ws_test_series_order", "o.discount_price", tot, unit),
    paidSubSeriesFor("ws_live_course_subscription", "ws_live_course_order", "o.discount_price", tot, unit),
    fetchRecent("package", cur, 0, limit), fetchRecent("course", cur, 0, limit), fetchRecent("book", cur, 0, limit),
    fetchRecent("ebook", cur, 0, limit), fetchRecent("testSeries", cur, 0, limit), fetchRecent("liveCourse", cur, 0, limit),
    summaryCounters(),
    activeCustomers(cur, prev),
    newCustomers(cur, prev),
  ]);

  const series = [...pkgSeries, ...courseSeries, ...ebookSeries, ...bookSeries, ...tsSeries, ...lcSeries];

  return {
    revenue: {
      pkg: pkgRev, course: courseRev, ebook: ebookRev, book: bookRev, testSeries: tsRev, liveCourse: lcRev,
      pkgPrev: pkgRevP.revenue, coursePrev: courseRevP.revenue, ebookPrev: ebookRevP.revenue, bookPrev: bookRevP.revenue,
      testSeriesPrev: tsRevP.revenue, liveCoursePrev: lcRevP.revenue,
    },
    // Total Order Reports chart folds ALL six paid categories so the aggregate stays
    // consistent with the per-category cards (test-series + live-course included).
    // Folded from `series` rather than re-aggregated: every series query already
    // COUNTs and SUMs the same window/filter, so summing the buckets is the same
    // number without a second pass over the range.
    totals: {
      orders: series.reduce((n, r) => n + r.orders, 0),
      earnings: series.reduce((n, r) => n + r.earnings, 0),
    },
    series,
    // The same rows, kept per product type so the chart can stack them.
    seriesByType: { package: pkgSeries, course: courseSeries, ebook: ebookSeries, book: bookSeries, testSeries: tsSeries, liveCourse: lcSeries },
    recentPackageSubs, recentCourseSubs, recentBookOrders, recentEbookSubs, recentTestSeriesSubs, recentLiveCourseSubs,
    activeCustomers: active,
    newCustomers: signups,
    summary: {
      customers: { total: counters.totalCustomers, active: counters.activeCustomers },
      catalog: { courses: counters.totalCourses, packages: counters.totalPackages, ebooks: counters.totalEbooks, books: counters.totalBooks, testSeries: counters.totalTestSeries, liveCourses: counters.totalLiveCourses },
      team: { promoters: counters.totalPromoters, educators: counters.totalEducators },
      enquiries: { offline: counters.pendingOfflineEnquiries, website: counters.pendingInquiries },
    },
  };
};

// ── trending: top sellers per product type over the dashboard window ──────────
/**
 * GET /admin/dashboard/trending. Ranks each paid category by number of sales inside
 * the window (ties → revenue), every product sold — no top-N cap. Each ranking counts exactly what that
 * product's report lists when filtered to the product + the same dates (Subscription /
 * Test Series / Live Course report, Ebook Subscriptions, Book Orders).
 * Grouped rows are id-only; names/images are batch-loaded afterwards.
 */
type RankRow = { id: number | null; orders: number; revenue: number };

const rankSubs = async (w: Win, scope: "course" | "package"): Promise<RankRow[]> => {
  const rows = scope === "package"
    ? await prisma.packageCourseSubscription.groupBy({
        by: ["packageId"],
        where: { packageCourseOrder: { status: "complete", createdAt: { gte: w.start, lte: w.end } }, courseId: null, packageId: { gt: 0 } },
        _count: { _all: true }, _sum: { amount: true },
        orderBy: [{ _count: { packageId: "desc" } }, { _sum: { amount: "desc" } }],
      })
    : await prisma.packageCourseSubscription.groupBy({
        by: ["courseId"],
        where: { packageCourseOrder: { status: "complete", createdAt: { gte: w.start, lte: w.end } }, courseId: { gt: 0 } },
        _count: { _all: true }, _sum: { amount: true },
        orderBy: [{ _count: { courseId: "desc" } }, { _sum: { amount: "desc" } }],
      });
  return rows.map((r: any) => ({ id: r.packageId ?? r.courseId ?? null, orders: r._count._all, revenue: num(r._sum.amount) }));
};

// RAW SQL — column names are strings, so `yarn typecheck` cannot catch a rename.
// Test series + live course: same rule as their cards (paidSubRevenue).
const rankPaidSubs = async (w: Win, subTable: string, orderTable: string, productCol: string): Promise<RankRow[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number; orders: bigint; revenue: any }[]>(
    `SELECT s.${productCol} AS id, COUNT(*) AS orders, COALESCE(SUM(o.discount_price),0) AS revenue
     FROM ${subTable} s JOIN ${orderTable} o ON o.id = s.order_id
     WHERE o.status = 'complete' AND o.created_at >= ? AND o.created_at <= ? AND s.${productCol} IS NOT NULL
     GROUP BY s.${productCol} ORDER BY orders DESC, revenue DESC`,
    w.start, w.end
  );
  return rows.map((r) => ({ id: Number(r.id), orders: Number(r.orders), revenue: num(r.revenue) }));
};
const rankTestSeries = (w: Win) => rankPaidSubs(w, "ws_test_series_subscription", "ws_test_series_order", "test_series_id");
const rankLiveCourses = (w: Win) => rankPaidSubs(w, "ws_live_course_subscription", "ws_live_course_order", "live_course_id");
// Completed ebook orders (card rule); the ebook id comes from the order's subscription
// row — the plan link is 0 on admin grants, so it cannot identify the ebook.
const rankEbooks = async (w: Win): Promise<RankRow[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number; orders: bigint; revenue: any }[]>(
    `SELECT s.ebook_id AS id, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(o.order_price),0) AS revenue
     FROM ws_ebook_order o JOIN ws_ebook_subscription s ON s.order_id = o.id
     WHERE o.created_at >= ? AND o.created_at <= ? AND o.status = 'complete' AND s.ebook_id IS NOT NULL
     GROUP BY s.ebook_id ORDER BY orders DESC, revenue DESC`,
    w.start, w.end
  );
  return rows.map((r) => ({ id: Number(r.id), orders: Number(r.orders), revenue: num(r.revenue) }));
};

// A book "sells" in an order when the Book Orders report's book filter would list that
// order: the book is in ws_book_order_item OR in the order's order_items JSON
// (admin-book findOrderKeysByBookId reads both). Revenue is item price × qty, from the
// item table when it has the line, else from the JSON.
const rankBooks = async (w: Win): Promise<RankRow[]> => {
  const orders = await prisma.bookOrder.findMany({
    where: { createdAt: { gte: w.start, lte: w.end }, status: "verified" },
    select: { receiptId: true, orderItems: true },
  });
  const tableItems = orders.length
    ? await prisma.bookOrderItem.findMany({
        where: { order_id: { in: orders.map((o) => o.receiptId) }, bookId: { not: null } },
        select: { order_id: true, bookId: true, qty: true, price: true },
      })
    : [];
  const tableByOrder = new Map<string, { bookId: number; qty: number; price: number }[]>();
  for (const it of tableItems) {
    const list = tableByOrder.get(it.order_id) ?? [];
    list.push({ bookId: it.bookId as number, qty: it.qty, price: it.price });
    tableByOrder.set(it.order_id, list);
  }
  const byBook = new Map<number, RankRow>();
  for (const order of orders) {
    const fromTable = tableByOrder.get(order.receiptId) ?? [];
    const tableBooks = new Set(fromTable.map((i) => i.bookId));
    const fromJson = dashTransformer.itemsFromJson(order.orderItems)
      .filter((i): i is typeof i & { bookId: number } => i.bookId != null && !tableBooks.has(i.bookId));
    const booksInOrder = new Set<number>();
    for (const item of [...fromTable, ...fromJson]) {
      const row = byBook.get(item.bookId) ?? { id: item.bookId, orders: 0, revenue: 0 };
      if (!booksInOrder.has(item.bookId)) row.orders++;
      row.revenue += item.price * item.qty;
      booksInOrder.add(item.bookId);
      byBook.set(item.bookId, row);
    }
  }
  return [...byBook.values()]
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
};

const idsOf = (rows: RankRow[]) => rows.map((r) => r.id).filter((x): x is number => x != null);

const withRefs = (rows: RankRow[], refs: { id: number; name: string | null; image: string | null }[]) => {
  const map = new Map(refs.map((r) => [r.id, r]));
  return rows
    .filter((r) => r.id != null)
    .map((r) => {
      const ref = map.get(r.id as number);
      return { _id: String(r.id), name: ref?.name ?? "—", image: ref?.image ?? null, orders: r.orders, revenue: r.revenue };
    });
};

const rankers: Record<ActivityType, (w: Win) => Promise<RankRow[]>> = {
  package: (w) => rankSubs(w, "package"),
  course: (w) => rankSubs(w, "course"),
  ebook: rankEbooks,
  book: rankBooks,
  testSeries: rankTestSeries,
  liveCourse: rankLiveCourses,
};

const loadRefs = (type: ActivityType, ids: number[]): Promise<{ id: number; name: string | null; image: string | null }[]> => {
  const where = { id: { in: ids } };
  const ref = { id: true, name: true, image: true } as const;
  switch (type) {
    case "package": return prisma.package.findMany({ where, select: ref });
    case "course": return prisma.course.findMany({ where, select: ref });
    case "ebook": return prisma.eBook.findMany({ where, select: ref });
    case "book": return prisma.book.findMany({ where, select: ref });
    case "liveCourse": return prisma.liveCourse.findMany({ where, select: ref });
    // ws_test_series uses title/thumbnail → mapped to name/image.
    case "testSeries":
      return prisma.testSeries.findMany({ where, select: { id: true, title: true, thumbnail: true } })
        .then((rows) => rows.map((t) => ({ id: t.id, name: t.title, image: t.thumbnail ?? null })));
  }
};

// One product type, one page of its ranking. The ranking is a GROUP BY over the
// window (one row per product sold), so it is computed whole and sliced; names and
// images are loaded for the returned page only.
export const fetchTrending = async (w: Win, type: ActivityType, skip: number, take: number) => {
  const ranked = (await rankers[type](w)).filter((r) => r.id != null);
  const page = ranked.slice(skip, skip + take);
  const ids = idsOf(page);
  const refs = ids.length ? await loadRefs(type, ids) : [];
  return { items: withRefs(page, refs), total: ranked.length, hasMore: skip + take < ranked.length };
};
