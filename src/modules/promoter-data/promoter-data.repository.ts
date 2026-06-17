import { prisma } from "../../config/prisma";

/**
 * Promoter analytics on SQL — the "what did this promoter earn / drive" reads
 * (customers, subscriptions, dashboard). Used by the promoter dashboard/customers/
 * subscription controllers when `isMysqlModule("promoter-data")`.
 *
 * ⚠ ATTRIBUTION MODEL (differs from Mongo — see MONGO_ONLY_MIGRATION_PLAN.md):
 * SQL has NO promoter_id / promoter_percentage / paid_amount columns on the
 * subscription tables. Instead, `ws_package_course_order.promocode` (and
 * `ws_ebook_order.promocode`) is a JSON SNAPSHOT of the whole promocode at
 * purchase, embedding `promoterId`, `promocode`, and
 * `promotedPackageCourseEbook[0].promoterPercentage`. We attribute a subscription
 * to a promoter by joining order→subscription (order.id = subscription.order_id)
 * and filtering on the JSON promoterId. Commission = amount * pct/100.
 *
 * All queries are raw SQL because Prisma can't express JSON_EXTRACT path filters
 * or DATE_FORMAT time-bucket grouping. `promoterId` is always passed as a bound
 * parameter (no string interpolation of user input).
 */

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface PromoterSubRow {
  id: number;
  customerId: number;
  amount: number;
  promocode: string | null;
  promoterPercentage: number;
  courseId: number | null;
  packageId: number | null;
  status: boolean;
  createdAt: Date | null;
}

export const promoterDataRepository = {
  // ─── Course/package subscriptions attributed to a promoter ───────────────
  /** Paginated course subs for a promoter, with the embedded promo % + names. */
  listCourseSubs: (promoterId: number, opts: { from?: Date; to?: Date; skip: number; take: number }) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT s.id, s.customer_id AS customerId, s.amount, s.status, s.created_at AS createdAt,
              s.course_id AS courseId, s.package_id AS packageId,
              JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promocode')) AS promocode,
              JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')) AS pct,
              c.full_name AS customerName, c.phone AS customerPhone,
              cr.name AS courseName
       FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       LEFT JOIN ws_customer c ON c.id = s.customer_id
       LEFT JOIN ws_course cr ON cr.id = s.course_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts.from ? "AND s.created_at >= ?" : ""}
         ${opts.to ? "AND s.created_at <= ?" : ""}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      ...[promoterId, ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : []), opts.take, opts.skip]
    ),

  countCourseSubs: async (promoterId: number, opts: { from?: Date; to?: Date }) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS n
       FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts.from ? "AND s.created_at >= ?" : ""}
         ${opts.to ? "AND s.created_at <= ?" : ""}`,
      ...[promoterId, ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : [])]
    );
    return num(rows[0]?.n);
  },

  // ─── Ebook subscriptions attributed to a promoter ────────────────────────
  listEbookSubs: (promoterId: number, opts: { from?: Date; to?: Date; skip: number; take: number }) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT s.id, s.customer_id AS customerId, s.price AS amount, s.status, s.created_at AS createdAt,
              s.ebook_id AS ebookId,
              JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promocode')) AS promocode,
              JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')) AS pct,
              c.full_name AS customerName, c.phone AS customerPhone,
              e.name AS ebookName, e.author AS ebookAuthor
       FROM ws_ebook_subscription s
       JOIN ws_ebook_order o ON o.id = s.order_id
       LEFT JOIN ws_customer c ON c.id = s.customer_id
       LEFT JOIN ws_ebook e ON e.id = s.ebook_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts.from ? "AND s.created_at >= ?" : ""}
         ${opts.to ? "AND s.created_at <= ?" : ""}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      ...[promoterId, ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : []), opts.take, opts.skip]
    ),

  countEbookSubs: async (promoterId: number, opts: { from?: Date; to?: Date }) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS n
       FROM ws_ebook_subscription s
       JOIN ws_ebook_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts.from ? "AND s.created_at >= ?" : ""}
         ${opts.to ? "AND s.created_at <= ?" : ""}`,
      ...[promoterId, ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : [])]
    );
    return num(rows[0]?.n);
  },

  // ─── Dashboard summary (course side: count, revenue, commission, customers) ─
  courseTotals: async (promoterId: number, opts?: { from?: Date; to?: Date; activeOnly?: boolean; now?: Date }) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS subscriptions,
              COALESCE(SUM(s.amount),0) AS earnings,
              COALESCE(SUM(s.amount * CAST(JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')) AS DECIMAL(10,2)) / 100),0) AS commission,
              COUNT(DISTINCT s.customer_id) AS uniqueCustomers
       FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts?.from ? "AND s.created_at >= ?" : ""}
         ${opts?.to ? "AND s.created_at <= ?" : ""}
         ${opts?.activeOnly ? "AND s.status = 1 AND s.end_at > ?" : ""}`,
      ...[promoterId, ...(opts?.from ? [opts.from] : []), ...(opts?.to ? [opts.to] : []), ...(opts?.activeOnly ? [opts?.now ?? new Date()] : [])]
    );
    const r = rows[0] ?? {};
    return {
      subscriptions: num(r.subscriptions),
      earnings: num(r.earnings),
      commission: num(r.commission),
      uniqueCustomers: num(r.uniqueCustomers),
    };
  },

  ebookRevenue: async (promoterId: number, opts?: { from?: Date; to?: Date }) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS subscriptions, COALESCE(SUM(s.price),0) AS earnings
       FROM ws_ebook_subscription s
       JOIN ws_ebook_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts?.from ? "AND s.created_at >= ?" : ""}
         ${opts?.to ? "AND s.created_at <= ?" : ""}`,
      ...[promoterId, ...(opts?.from ? [opts.from] : []), ...(opts?.to ? [opts.to] : [])]
    );
    return { subscriptions: num(rows[0]?.subscriptions), earnings: num(rows[0]?.earnings) };
  },

  // ─── Time-series buckets for the overview chart ──────────────────────────
  /** `fmt` is a MySQL DATE_FORMAT string (e.g. '%Y-%m-%d'). */
  courseSeries: (promoterId: number, fmt: string, opts: { from?: Date; to?: Date }) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT DATE_FORMAT(s.created_at, ?) AS bucket,
              COUNT(*) AS subscriptions,
              COALESCE(SUM(s.amount),0) AS earnings
       FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         ${opts.from ? "AND s.created_at >= ?" : ""}
         ${opts.to ? "AND s.created_at <= ?" : ""}
       GROUP BY bucket ORDER BY bucket ASC`,
      ...[fmt, promoterId, ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : [])]
    ),

  // ─── Subscription report: by course + by month (with commission) ─────────
  reportByCourse: (promoterId: number) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT s.course_id AS courseId, cr.name AS courseName,
              COUNT(*) AS count,
              COALESCE(SUM(s.amount),0) AS revenue,
              COALESCE(SUM(s.amount * CAST(JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')) AS DECIMAL(10,2)) / 100),0) AS commission
       FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       LEFT JOIN ws_course cr ON cr.id = s.course_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
       GROUP BY s.course_id, cr.name
       ORDER BY count DESC`,
      promoterId
    ),

  reportByMonth: (promoterId: number) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT DATE_FORMAT(s.created_at,'%Y-%m') AS ym,
              COUNT(*) AS count,
              COALESCE(SUM(s.amount),0) AS revenue,
              COALESCE(SUM(s.amount * CAST(JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')) AS DECIMAL(10,2)) / 100),0) AS commission
       FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
       GROUP BY ym ORDER BY ym DESC LIMIT 12`,
      promoterId
    ),

  // ─── Promocode usage (count + revenue) by code string, for this promoter ──
  /** Usage per promocode string across course + ebook orders' JSON snapshot. */
  promocodeUsage: async (promoterId: number) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT code, COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue FROM (
         SELECT JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promocode')) AS code, s.amount AS amount
         FROM ws_package_course_subscription s
         JOIN ws_package_course_order o ON o.id = s.order_id
         WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
         UNION ALL
         SELECT JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promocode')) AS code, s.price AS amount
         FROM ws_ebook_subscription s
         JOIN ws_ebook_order o ON o.id = s.order_id
         WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
       ) u GROUP BY code`,
      promoterId, promoterId
    );
    const map = new Map<string, { count: number; revenue: number }>();
    for (const r of rows) map.set(String(r.code), { count: num(r.count), revenue: num(r.revenue) });
    return map;
  },

  // ─── Distinct customers attributed to a promoter (for the customers list) ─
  listCustomerIds: async (promoterId: number) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT s.customer_id AS id FROM ws_package_course_subscription s
       JOIN ws_package_course_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
       UNION
       SELECT DISTINCT s.customer_id AS id FROM ws_ebook_subscription s
       JOIN ws_ebook_order o ON o.id = s.order_id
       WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?`,
      promoterId, promoterId
    );
    return rows.map((r) => num(r.id)).filter((n) => n > 0);
  },
};
