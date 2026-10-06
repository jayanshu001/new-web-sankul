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


type Win = { start: Date; end: Date };
export type BucketUnit = "hour" | "day" | "month";
const num = (v: any) => (v == null ? 0 : Number(v));

// ── revenue + count for a window ───────────────────────────────────────────────
const subRevenue = async (w: Win, courseScope: "course" | "package" | "all") => {
  const where: any = { createdAt: { gte: w.start, lte: w.end } };
  if (courseScope === "course") where.courseId = { not: null };
  else if (courseScope === "package") where.courseId = null;
  const agg = await prisma.packageCourseSubscription.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
// Same rows as the Ebook Subscriptions list (subscription created_at); revenue is the
// charged price on their orders. Counting orders instead kept a sale on the dashboard
// after its subscription was deleted from the list.
const ebookRevenue = async (w: Win) => {
  const subWhere = { createdAt: { gte: w.start, lte: w.end } };
  const [count, agg] = await Promise.all([
    prisma.eBookSubscription.count({ where: subWhere }),
    prisma.eBookOrder.aggregate({ where: { eBookSubscription: { some: subWhere } }, _sum: { orderPrice: true } }),
  ]);
  return { revenue: num(agg._sum.orderPrice), count };
};

const bookRevenue = async (w: Win) => {
  const agg = await prisma.bookOrder.aggregate({ where: { createdAt: { gte: w.start, lte: w.end }, status: "verified" }, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
// Test-series subscription rows are created ONLY on verify (pending state lives on
// ws_test_series_order), so every row is a paid purchase — no status filter, sum
// `amount` (was `price` until the 2026-08-31 package-shape rename).
const testSeriesRevenue = async (w: Win) => {
  const agg = await prisma.testSeriesSubscription.aggregate({ where: { createdAt: { gte: w.start, lte: w.end } }, _sum: { amount: true }, _count: { _all: true } });
  return { revenue: num(agg._sum.amount), count: agg._count._all };
};
// Revenue comes from the ORDER table (2026-08-25): live course used to be
// single-table, so this had to sum the subscription and exclude pending/folded rows
// via payment_status. Each purchase is now its own completed order, which also means
// a renewal is finally counted as its own sale instead of vanishing into a folded row.
//
// Same numbers as the Live Course Report summary (admin-live-course repo.aggSubs):
// count = subscriptions, revenue = their orders — so a deleted subscription leaves both.
const liveCourseRevenue = async (w: Win) => {
  const subWhere = { createdAt: { gte: w.start, lte: w.end } };
  const [count, agg] = await Promise.all([
    prisma.liveCourseSubscription.count({ where: subWhere }),
    prisma.liveCourseOrder.aggregate({ where: { subscriptions: { some: subWhere } }, _sum: { amount: true } }),
  ]);
  // `amount` = ws_live_course_order.discount_price (the charged amount), renamed
  // from paid_amount when the table took the package shape (2026-08-27).
  return { revenue: num(agg._sum.amount), count };
};

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

// Subscription-counted products (ebook, live course): bucket the subscription rows,
// revenue from each one's order — the chart's view of ebookRevenue/liveCourseRevenue.
const subSeriesFor = async (subTable: string, orderTable: string, revenueCol: string, w: Win, unit: BucketUnit) => {
  const fn = unit === "hour" ? "HOUR" : unit === "month" ? "MONTH" : "DAYOFMONTH";
  const rows = await prisma.$queryRawUnsafe<{ slot: number; orders: bigint; earnings: any }[]>(
    `SELECT ${fn}(s.created_at) AS slot, COUNT(*) AS orders, COALESCE(SUM(o.${revenueCol}),0) AS earnings
     FROM ${subTable} s LEFT JOIN ${orderTable} o ON o.id = s.order_id
     WHERE s.created_at >= ? AND s.created_at <= ?
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

export const fetchDashboardData = async (opts: {
  orderWindow: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
  totalWindow: { start: Date; end: Date; prevStart: Date; prevEnd: Date };
  unit: BucketUnit;
  limit: number;
}) => {
  const { orderWindow: ow, totalWindow: tw, unit, limit } = opts;
  const cur: Win = { start: ow.start, end: ow.end };
  const prev: Win = { start: ow.prevStart, end: ow.prevEnd };
  const tot: Win = { start: tw.start, end: tw.end };

  const [
    pkgRev, courseRev, ebookRev, bookRev, tsRev, lcRev,
    pkgRevP, courseRevP, ebookRevP, bookRevP, tsRevP, lcRevP,
    pkgSeries, courseSeries, ebookSeries, bookSeries, tsSeries, lcSeries,
    recentPackageSubs, recentCourseSubs, recentBookOrders, recentEbookSubs, recentTestSeriesSubs, recentLiveCourseSubs,
    counters,
  ] = await Promise.all([
    subRevenue(cur, "package"), subRevenue(cur, "course"), ebookRevenue(cur), bookRevenue(cur), testSeriesRevenue(cur), liveCourseRevenue(cur),
    subRevenue(prev, "package"), subRevenue(prev, "course"), ebookRevenue(prev), bookRevenue(prev), testSeriesRevenue(prev), liveCourseRevenue(prev),
    // NOTE: the five `*Revenue(tot)` aggregates that used to sit here are gone. Each
    // scanned exactly the same window, table and filter as its seriesFor() below and
    // then summed it — so the Total Order Reports card was paying for the range twice.
    // `totals` is now folded from the series rows (identical numbers, half the scans,
    // five fewer connections held for the length of a year-range scan).
    seriesFor("ws_package_course_subscription", "amount", tot, unit, "AND course_id IS NULL"),
    seriesFor("ws_package_course_subscription", "amount", tot, unit, "AND course_id IS NOT NULL"),
    subSeriesFor("ws_ebook_subscription", "ws_ebook_order", "order_price", tot, unit),
    seriesFor("ws_book_order", "order_price", tot, unit, "AND status = 'verified'"),
    // Raw column name: `price` → `amount` (2026-08-31). Prisma does not validate
    // strings passed to $queryRawUnsafe, so a rename here only fails at runtime.
    seriesFor("ws_test_series_subscription", "amount", tot, unit),
    // Order table + its "complete" vocabulary (was ws_live_course_subscription /
    // payment_status='verified' before the 2026-08-25 split).
    // RAW SQL — the column name is a string, so `yarn typecheck` cannot catch a rename.
    // `paid_amount` became `discount_price` when the table took the
    // ws_package_course_order shape (2026-08-27). Keep this in step with the Prisma
    // field `amount` used by liveCourseRevenue above.
    subSeriesFor("ws_live_course_subscription", "ws_live_course_order", "discount_price", tot, unit),
    prisma.packageCourseSubscription.findMany({ where: { courseId: null }, include: { package: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.packageCourseSubscription.findMany({ where: { courseId: { not: null } }, include: { course: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    // Paid only, like the Book Orders card/report — pending checkouts are not purchases.
    prisma.bookOrder.findMany({ where: { status: "verified" }, select: { id: true, receiptId: true, amount: true, status: true, createdAt: true, orderItems: true }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.eBookSubscription.findMany({ include: { eBook: { select: { id: true, name: true, image: true } }, customer: { select: { id: true, fullName: true, phoneNumber: true } } }, orderBy: { createdAt: "desc" }, take: limit }),
    // TestSeries/LiveCourse subscription models carry only scalar FKs (no Prisma
    // relations) — refs are batch-loaded below.
    prisma.testSeriesSubscription.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    // "Recent purchases" is an ORDER concern — reading the order table also makes a
    // renewal show up as its own recent sale (2026-08-25 split).
    prisma.liveCourseOrder.findMany({ where: { status: "complete" }, orderBy: { createdAt: "desc" }, take: limit }),
    summaryCounters(),
  ]);

  const series = [...pkgSeries, ...courseSeries, ...ebookSeries, ...bookSeries, ...tsSeries, ...lcSeries];

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
    // Folded from `series` rather than re-aggregated: every series query already
    // COUNTs and SUMs the same window/filter, so summing the buckets is the same
    // number without a second pass over the range.
    totals: {
      orders: series.reduce((n, r) => n + r.orders, 0),
      earnings: series.reduce((n, r) => n + r.earnings, 0),
    },
    series,
    recentPackageSubs: recentPackageSubs.map(dashTransformer.toPackageSubDto),
    recentCourseSubs: recentCourseSubs.map(dashTransformer.toCourseSubDto),
    recentBookOrders: recentBookOrders.map((o) =>
      dashTransformer.toBookOrderDto(o, bookItemsByOrder.get(o.id) ?? [], bookMap)
    ),
    recentEbookSubs: recentEbookSubs.map(dashTransformer.toEbookSubDto),
    recentTestSeriesSubs: recentTestSeriesSubs.map((s) => dashTransformer.toTestSeriesSubDto(s, custMap, tsMap)),
    recentLiveCourseSubs: recentLiveCourseSubs.map((s) => dashTransformer.toLiveCourseSubDto(s, custMap, lcMap)),
    summary: {
      customers: { total: counters.totalCustomers, active: counters.activeCustomers },
      catalog: { courses: counters.totalCourses, packages: counters.totalPackages, ebooks: counters.totalEbooks, books: counters.totalBooks, testSeries: counters.totalTestSeries, liveCourses: counters.totalLiveCourses },
      team: { promoters: counters.totalPromoters, educators: counters.totalEducators },
      enquiries: { offline: counters.pendingOfflineEnquiries, website: counters.pendingInquiries },
    },
  };
};

// ── trending: top sellers per product type over a rolling window ───────────────
/**
 * GET /admin/dashboard/trending. Ranks each paid category by number of sales since
 * `since` (ties → revenue), top TRENDING_LIMIT. Same tables + paid filters as the
 * revenue cards above, so a product's revenue here sums into its category card.
 * Grouped rows are id-only; names/images are batch-loaded afterwards.
 */
const TRENDING_LIMIT = 5;
type RankRow = { id: number | null; orders: number; revenue: number };

const rankSubs = async (since: Date, scope: "course" | "package"): Promise<RankRow[]> => {
  const rows = scope === "package"
    ? await prisma.packageCourseSubscription.groupBy({
        by: ["packageId"],
        where: { createdAt: { gte: since }, courseId: null, packageId: { not: null } },
        _count: { _all: true }, _sum: { amount: true },
        orderBy: [{ _count: { packageId: "desc" } }, { _sum: { amount: "desc" } }],
        take: TRENDING_LIMIT,
      })
    : await prisma.packageCourseSubscription.groupBy({
        by: ["courseId"],
        where: { createdAt: { gte: since }, courseId: { not: null } },
        _count: { _all: true }, _sum: { amount: true },
        orderBy: [{ _count: { courseId: "desc" } }, { _sum: { amount: "desc" } }],
        take: TRENDING_LIMIT,
      });
  return rows.map((r: any) => ({ id: r.packageId ?? r.courseId ?? null, orders: r._count._all, revenue: num(r._sum.amount) }));
};

const rankTestSeries = async (since: Date): Promise<RankRow[]> => {
  const rows = await prisma.testSeriesSubscription.groupBy({
    by: ["testSeriesId"],
    where: { createdAt: { gte: since } },
    _count: { _all: true }, _sum: { amount: true },
    orderBy: [{ _count: { testSeriesId: "desc" } }, { _sum: { amount: "desc" } }],
    take: TRENDING_LIMIT,
  });
  return rows.map((r) => ({ id: r.testSeriesId, orders: r._count._all, revenue: num(r._sum.amount) }));
};

const rankLiveCourses = async (since: Date): Promise<RankRow[]> => {
  const rows = await prisma.liveCourseOrder.groupBy({
    by: ["liveCourseId"],
    where: { createdAt: { gte: since }, status: "complete" },
    _count: { _all: true }, _sum: { amount: true },
    orderBy: [{ _count: { liveCourseId: "desc" } }, { _sum: { amount: "desc" } }],
    take: TRENDING_LIMIT,
  });
  return rows.map((r) => ({ id: r.liveCourseId, orders: r._count._all, revenue: num(r._sum.amount) }));
};

// RAW SQL — column names are strings, so `yarn typecheck` cannot catch a rename.
// Ebook orders carry the ebook only via their plan (ws_package_course_ebook_price).
const rankEbooks = async (since: Date): Promise<RankRow[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number; orders: bigint; revenue: any }[]>(
    `SELECT p.ebook_id AS id, COUNT(*) AS orders, COALESCE(SUM(o.order_price),0) AS revenue
     FROM ws_ebook_order o JOIN ws_package_course_ebook_price p ON p.id = o.plan_id
     WHERE o.created_at >= ? AND o.status = 'complete' AND p.ebook_id IS NOT NULL
     GROUP BY p.ebook_id ORDER BY orders DESC, revenue DESC LIMIT ${TRENDING_LIMIT}`,
    since
  );
  return rows.map((r) => ({ id: Number(r.id), orders: Number(r.orders), revenue: num(r.revenue) }));
};

// Line items are keyed by the VARCHAR business key (ws_book_order.order_id) and are
// written without created_at, so the window filters on the order. `price` is per
// unit; revenue excludes shipping.
const rankBooks = async (since: Date): Promise<RankRow[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number; orders: bigint; revenue: any }[]>(
    `SELECT i.book_id AS id, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(i.price * i.qty),0) AS revenue
     FROM ws_book_order o JOIN ws_book_order_item i ON i.order_id = o.order_id
     WHERE o.created_at >= ? AND o.status = 'verified' AND i.book_id IS NOT NULL
     GROUP BY i.book_id ORDER BY orders DESC, revenue DESC LIMIT ${TRENDING_LIMIT}`,
    since
  );
  return rows.map((r) => ({ id: Number(r.id), orders: Number(r.orders), revenue: num(r.revenue) }));
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

export const fetchTrending = async (since: Date) => {
  const [pkg, course, ebook, book, testSeries, liveCourse] = await Promise.all([
    rankSubs(since, "package"), rankSubs(since, "course"), rankEbooks(since), rankBooks(since), rankTestSeries(since), rankLiveCourses(since),
  ]);
  const ref = { id: true, name: true, image: true } as const;
  const [pkgRefs, courseRefs, ebookRefs, bookRefs, tsRefs, lcRefs] = await prisma.$transaction([
    prisma.package.findMany({ where: { id: { in: idsOf(pkg) } }, select: ref }),
    prisma.course.findMany({ where: { id: { in: idsOf(course) } }, select: ref }),
    prisma.eBook.findMany({ where: { id: { in: idsOf(ebook) } }, select: ref }),
    prisma.book.findMany({ where: { id: { in: idsOf(book) } }, select: ref }),
    // ws_test_series uses title/thumbnail → mapped to name/image below.
    prisma.testSeries.findMany({ where: { id: { in: idsOf(testSeries) } }, select: { id: true, title: true, thumbnail: true } }),
    prisma.liveCourse.findMany({ where: { id: { in: idsOf(liveCourse) } }, select: ref }),
  ]);
  return {
    package: withRefs(pkg, pkgRefs),
    course: withRefs(course, courseRefs),
    ebook: withRefs(ebook, ebookRefs),
    book: withRefs(book, bookRefs),
    testSeries: withRefs(testSeries, tsRefs.map((t) => ({ id: t.id, name: t.title, image: t.thumbnail ?? null }))),
    liveCourse: withRefs(liveCourse, lcRefs),
  };
};
