// Admin subscriptions: course/package report, exports, grant/extend and summary reports.
import ExcelJS from "exceljs";
import { resolveShippingIdForAddress } from "../customer-shipping/customer-shipping.service";
import type { ReportSource } from "../../utils/reportStream";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { computeEndAt } from "../../utils/planDuration";
import { adminSubscriptionRepository as repo, type SubTrackingExportCursor } from "./admin-subscription.repository";
import { computeMaterialSplit } from "../commerce-order/commerce-order.service";
import { andWhere, statusWhere, normalizeStatus, reportRow, blankStrToNull, decToNum, rowHasMaterial, trackingToNumber } from "../../utils/reportFilters";
import { PaymentMethod } from "../../shared/enums";
import { fmtExportDate } from "../../utils/csvExport";
import {
  adminDisplayName,
  appendAdminRemark,
  movedRemarkText,
  parseRemarkHistory,
  planAddDays,
  planDateShift,
  planQueuedStart,
  planDeactivation,
  planDeactivationRevert,
  type DateShift,
} from "../../utils/subscriptionRemarkHistory";
import { parsePositiveInt } from "../../utils/parseId";

// Report `orderMethod` filter = the payment GATEWAY (order.payment_method), distinct
// from `paymentMethod` (= payment_type online|backend, the activation channel). FE
// sends lowercase; map to the canonical enum value (Paykun/Paytm are capitalized).
const GATEWAY_BY_INPUT: Record<string, string> = {
  razorpay: PaymentMethod.RAZORPAY, bank: PaymentMethod.BANK, cash: PaymentMethod.CASH,
  free: PaymentMethod.FREE, paykun: PaymentMethod.PAYKUN, paytm: PaymentMethod.PAYTM,
};


export const parseSubId = parsePositiveInt;

const idStr = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);

// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to →
// 23:59:59.999 at Asia/Kolkata, +05:30). The admin picks a calendar date in IST, so
// a naive local/UTC parse would drop the last 5.5h of the day — pin the offset.
// Full timestamps pass through as-is. Invalid → undefined (no bound).
const parseDayBound = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  // "YYYY-MM-DDTHH:mm" (the report date-time picker) is IST wall-clock too; the
  // to-bound covers the whole picked minute.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`)
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)
      ? new Date(`${s}:${end ? "59.999" : "00.000"}+05:30`)
      : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// The order's `promocode` column is a JSON snapshot of the applied code at
// purchase (see promoter-data); pull the human code string out of it.
const promoCodeOf = (j: any): string | null => {
  if (!j) return null;
  if (typeof j === "string") return j || null;
  if (typeof j === "object" && typeof j.promocode === "string") return j.promocode || null;
  return null;
};

const customerRef = (c: { id: number; fullName: string | null; phoneNumber: string; emailAddress?: string | null } | undefined) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber, ...(c.emailAddress !== undefined ? { emailAddress: c.emailAddress ?? null } : {}) };
};

// Shared contract across the 4 admin subscription reports (docs/REPORTS_SUBSCRIPTIONS_ADMIN.md):
// list() returns { summary, data, pagination } (summary respects all filters, ignores
// pagination); the same filters drive the CSV/Excel export (no pagination).
// `status` is the normalized active|expired|inactive; paymentMethod is the coarse
// online|backend (= payment_type). Date ranges are independent:
// dateFrom/dateTo → createdAt, startFrom/startTo → startAt, endFrom/endTo → endAt.
export interface CourseSubReportQuery {
  customerId?: string; courseId?: string; packageId?: string; status?: string;
  paymentMethod?: string; hasMaterial?: boolean;
  // hasWsCoin → scope by whether the linked order redeemed Ws Coin (ws_coin > 0);
  // false includes order-less subs (see repository buildSubWhere).
  hasWsCoin?: boolean;
  // promoterId/promocodeId → filter to subs by that promoter / promocode; orderMethod
  // → payment gateway (order.payment_method), distinct from paymentMethod (activation).
  promoterId?: string; promocodeId?: string; orderMethod?: string;
  dateFrom?: string; dateTo?: string;
  startFrom?: string; startTo?: string;
  endFrom?: string; endTo?: string;
  // Accepted so the FE param is honored once a source exists; there is no column for
  // Activation Type yet, so it is a no-op.
  activationType?: string;
  search?: string; sortBy?: string; sortOrder?: string; type?: string;
}

// Resolve the composed Prisma where (base filters AND normalized status) for a
// report query. Returns null when a promocode filter matched nothing (→ empty result).
const resolveCourseSubWhere = async (q: CourseSubReportQuery, now: Date) => {
  // course/package names resolve to (small) id lists; customer + order/payment/tracking
  // ids are matched in-query from `search` (repo buildSubWhere).
  let courseIdsIn: number[] | undefined, packageIdsIn: number[] | undefined;
  if (q.search) {
    [courseIdsIn, packageIdsIn] = await Promise.all([repo.courseIdsByText(q.search), repo.packageIdsByText(q.search)]);
  }
  // promocodeId → code → set of matching order ids (JSON snapshot, no live FK).
  // Unknown code or no matching orders ⇒ empty result (null).
  let orderIdsIn: number[] | undefined;
  if (q.promocodeId) {
    const pid = parseSubId(q.promocodeId);
    const code = pid ? (await repo.promocodeCodeById(pid))?.promocode ?? null : null;
    if (!code) return null;
    orderIdsIn = await repo.orderIdsByPromocode(code);
    if (!orderIdsIn.length) return null;
  }
  const base = repo.buildCourseSubBaseWhere({
    customerId: q.customerId ? parseSubId(q.customerId) ?? undefined : undefined,
    courseId: q.courseId ? parseSubId(q.courseId) ?? undefined : undefined,
    packageId: q.packageId ? parseSubId(q.packageId) ?? undefined : undefined,
    paymentType: q.paymentMethod === "online" ? "online" : q.paymentMethod === "backend" ? "backend" : undefined,
    hasMaterial: q.hasMaterial,
    hasWsCoin: q.hasWsCoin,
    promoterId: q.promoterId ? parseSubId(q.promoterId) ?? undefined : undefined,
    orderMethod: q.orderMethod ? GATEWAY_BY_INPUT[q.orderMethod.trim().toLowerCase()] : undefined,
    orderIdsIn,
    fromDate: parseDayBound(q.dateFrom, false),
    toDate: parseDayBound(q.dateTo, true),
    startFrom: parseDayBound(q.startFrom, false),
    startTo: parseDayBound(q.startTo, true),
    endFrom: parseDayBound(q.endFrom, false),
    endTo: parseDayBound(q.endTo, true),
    type: (q.type === "course" || q.type === "package" ? q.type : undefined) as "course" | "package" | undefined,
    courseIdsIn, packageIdsIn, search: q.search,
  });
  const listWhere = andWhere(base, statusWhere(q.status, now));
  const sortBy = q.sortBy ?? "createdAt";
  const sortDir = (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc";
  return { listWhere, sortBy, sortDir };
};

const hydrateCourseSubRows = async (rows: Awaited<ReturnType<typeof repo.listCourseSubsByWhere>>, now: Date) => {
  const uniq = (xs: (number | null | undefined)[]) => [...new Set(xs.filter((x): x is number => x != null && x > 0))];
  const [custs, courses, packages, plans, orders, shippings, promoters, admins] = await Promise.all([
    repo.customersByIds(uniq(rows.map((r) => r.customerId))).then((xs) => new Map(xs.map((c) => [c.id, c]))),
    repo.coursesByIds(uniq(rows.map((r) => r.courseId))).then((xs) => new Map(xs.map((c) => [c.id, c]))),
    repo.packagesByIds(uniq(rows.map((r) => r.packageId))).then((xs) => new Map(xs.map((p) => [p.id, p]))),
    repo.plansByIds(uniq(rows.map((r) => r.planId))).then((xs) => new Map(xs.map((p) => [p.id, p]))),
    repo.ordersByIds(uniq(rows.map((r) => r.orderId))).then((xs) => new Map(xs.map((o) => [o.id, o]))),
    repo.shippingsByIds(uniq(rows.map((r) => r.shippingId))).then((xs) => new Map(xs.map((s) => [s.id, s]))),
    repo.promotersByIds(uniq(rows.map((r) => r.promoterId))).then((xs) => new Map(xs.map((p) => [p.id, p]))),
    repo.adminUsersByIds(uniq(rows.map((r) => r.created_by))).then((xs) => new Map(xs.map((u) => [Number(u.id), u]))),
  ]);
  // Educators are reached through the hydrated courses (course → educator_id).
  const educators = new Map(
    (await repo.educatorsByIds(uniq([...courses.values()].map((c: any) => c.courseEducatorId)))).map((e) => [e.id, e])
  );
  // Promocode ids are resolved from the order snapshot's code string (no live FK).
  const promoCodes = [...new Set([...orders.values()].map((o) => promoCodeOf(o.promocode)).filter((c): c is string => !!c))];
  const promocodeIds = new Map((await repo.promocodesByCodes(promoCodes)).map((p) => [p.promocode, p.id]));

  return rows.map((r) => {
    const course = r.courseId ? courses.get(r.courseId) : null;
    const pkg = r.packageId ? packages.get(r.packageId) : null;
    const plan = r.planId ? plans.get(r.planId) : null;
    const order = r.orderId ? orders.get(r.orderId) : null;
    const ship = r.shippingId ? shippings.get(r.shippingId) : null;
    const promoter = r.promoterId ? promoters.get(r.promoterId) : null;
    const educator = course?.courseEducatorId ? educators.get(course.courseEducatorId) : null;
    const admin = r.created_by != null ? admins.get(r.created_by) : null;
    const product = course
      ? { _id: String(course.id), type: "course" as const, name: course.name, image: course.image ?? null }
      : pkg
        ? { _id: String(pkg.id), type: "package" as const, name: pkg.name, image: pkg.image ?? null }
        : null;
    const base = reportRow({
      cust: r.customerId ? custs.get(r.customerId) : undefined,
      product,
      plan: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: Number(plan.price) } : null,
      amount: r.amount != null ? Number(r.amount) : 0,
      paymentMethod: r.payment_type === "backend" ? "backend" : "online",
      status: normalizeStatus({ status: r.status, startAt: r.startAt, endAt: r.endAt }, now),
      startAt: r.startAt ?? null, endAt: r.endAt ?? null, createdAt: r.createdAt ?? null,
    });
    const adminName = admin ? `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() : "";
    const promocode = order ? promoCodeOf(order.promocode) : null;
    return {
      id: r.id,
      ...base,
      trackingId: trackingToNumber(r.trackingId),
      // + ids so the report can link to each detail page
      educatorName: educator?.name ?? null,
      educatorId: educator?.id ?? null,
      promoterName: promoter?.full_name ?? null,
      promoterId: promoter?.id ?? null,
      promocode,
      promocodeId: promocode ? promocodeIds.get(promocode) ?? null : null,
      courseAmount: decToNum(r.courseAmount),
      materialAmount: decToNum(r.materialAmount),
      wsCoin: order?.wsCoin ?? null,
      // Payment gateway from the linked order (razorpay|bank|cash|free|paykun|paytm),
      // lowercased to match the orderMethod filter values; null when there's no order.
      orderMethod: order?.paymentMethod ? String(order.paymentMethod).toLowerCase() : null,
      materialType: rowHasMaterial(r) ? "With Material" : "Without Material",
      // No source for "Activation Type" yet.
      activationType: null as string | null,
      razorpayOrderId: order ? blankStrToNull(order.gatewayOrderId) : null,
      razorpayPaymentId: order ? blankStrToNull(order.gatewayPaymentId) : null,
      bankTransactionId: order ? blankStrToNull(order.bankTransactionId) : null,
      shipping: ship
        ? {
            address: ship.address ?? null,
            address2: ship.address_2 ?? null,
            city: ship.city ?? null,
            pincode: ship.pincode ?? null,
            alternatePhone: ship.alternate_phone != null ? String(ship.alternate_phone) : null,
          }
        : null,
      remarks: r.remarks ?? null,
      activatedBy: adminName || null,
    };
  });
};

// Default a bounded created_at window for unscoped list queries so the admin
// subscription report doesn't full-scan ~600k rows when no date/filter is sent
// (k6 J7, dashboard widgets). Export keeps caller-supplied filters unchanged.
const withListDateDefaults = (q: CourseSubReportQuery): CourseSubReportQuery => {
  const hasDate = q.dateFrom || q.dateTo;
  const hasNarrow =
    q.customerId ||
    q.courseId ||
    q.packageId ||
    q.search ||
    q.promoterId ||
    q.promocodeId;
  if (hasDate || hasNarrow) return q;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 90);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  return { ...q, dateFrom: isoDay(from), dateTo: isoDay(to) };
};

// Report page with summary; an unscoped query defaults to the last 90 days.
export const listCourseSubscriptions = async (q: CourseSubReportQuery & { page: number; limit: number }) => {
  const now = new Date();
  const emptyPage = { summary: { totalCount: 0, totalRevenue: 0, activeCount: 0, expiredCount: 0 }, data: [], pagination: { total: 0, page: q.page, limit: q.limit, totalPages: 0 } };

  const resolved = await resolveCourseSubWhere(withListDateDefaults(q), now);
  if (!resolved) return emptyPage;
  const { listWhere, sortBy, sortDir } = resolved;

  const [rows, agg, activeCount, expiredCount] = await Promise.all([
    repo.listCourseSubsByWhere(listWhere, sortBy, sortDir, (q.page - 1) * q.limit, q.limit),
    repo.aggCourseSubs(listWhere),
    repo.countSubs(andWhere(listWhere, statusWhere("active", now))),
    repo.countSubs(andWhere(listWhere, statusWhere("expired", now))),
  ]);
  const total = agg._count._all;
  const data = await hydrateCourseSubRows(rows, now);

  return {
    summary: { totalCount: total, totalRevenue: Number(agg._sum.amount ?? 0), activeCount, expiredCount },
    data,
    pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
  };
};

// Report export: same filters as the list but the entire filtered set, no pagination
// and no row cap (a 300k-row filter must export every row). Paged in keyset batches
// (id DESC, no deep OFFSET) and hydrated one batch at a time so memory stays bounded.
// Both formats share one column spec, and the async export job reuses these builders.
const EXPORT_BATCH = 5_000;

async function* iterateCourseSubExportRows(q: CourseSubReportQuery, now: Date) {
  const resolved = await resolveCourseSubWhere(withListDateDefaults(q), now);
  if (!resolved) return;
  const { listWhere } = resolved;
  // Material report: tracked rows first (tracking ASC), then the untracked tail (id ASC)
  // — same walk as the admin book-orders export.
  if (q.hasMaterial === true) {
    let cursor: SubTrackingExportCursor = { untracked: false };
    for (;;) {
      const rows = await repo.listCourseSubsTrackingPageKeyset(listWhere, cursor, EXPORT_BATCH);
      if (rows.length) yield await hydrateCourseSubRows(rows, now);
      if (rows.length === EXPORT_BATCH) {
        const last = rows[rows.length - 1];
        cursor = cursor.untracked ? { untracked: true, afterId: last.id } : { untracked: false, afterTracking: last.trackingId!, afterId: last.id };
      } else if (!cursor.untracked) {
        cursor = { untracked: true };
      } else break;
    }
    return;
  }
  let beforeId: number | undefined;
  for (;;) {
    const rows = await repo.listCourseSubsPageKeyset(listWhere, beforeId, EXPORT_BATCH);
    if (!rows.length) break;
    yield await hydrateCourseSubRows(rows, now);
    if (rows.length < EXPORT_BATCH) break;
    beforeId = rows[rows.length - 1].id;
  }
}

// Timestamps render as IST (UTC+5:30, no DST) as `YYYY-MM-DD HH:mm:ss`: shift the instant
// by +5:30 and read the wall-clock parts off the shifted value.
// Column order: the client's Subscription-WithMaterial-Report.csv set first, then the
// extra on-screen columns. A row is a course OR a package, so only one name column is filled.
const REPORT_EXPORT_COLUMNS: { header: string; get: (r: any) => string | number }[] = [
  { header: "Created At", get: (r) => fmtExportDate(r.createdAt) },
  { header: "Tracking ID", get: (r) => r.trackingId ?? "" },
  { header: "Order Method", get: (r) => r.orderMethod ?? "" },
  { header: "Customer Name", get: (r) => r.customer?.name ?? "" },
  { header: "Email", get: (r) => r.customer?.email ?? "" },
  { header: "Phone", get: (r) => r.customer?.phone ?? "" },
  { header: "Alternate Phone", get: (r) => r.shipping?.alternatePhone ?? "" },
  { header: "Address", get: (r) => [r.shipping?.address, r.shipping?.address2].filter(Boolean).join(", ") },
  { header: "City", get: (r) => r.shipping?.city ?? "" },
  { header: "Pincode", get: (r) => r.shipping?.pincode ?? "" },
  { header: "Package Name", get: (r) => (r.product?.type === "package" ? r.product?.name : "") ?? "" },
  { header: "Course Name", get: (r) => (r.product?.type === "course" ? r.product?.name : "") ?? "" },
  { header: "Educator Name", get: (r) => r.educatorName ?? "" },
  { header: "Plan", get: (r) => r.plan?.name ?? "" },
  { header: "Start At", get: (r) => fmtExportDate(r.startAt) },
  { header: "End At", get: (r) => fmtExportDate(r.endAt) },
  { header: "Status", get: (r) => r.status ?? "" },
  { header: "Material Type", get: (r) => r.materialType ?? "" },
  // Activation Type (online | backend) comes from `paymentMethod` (= payment_type), as on
  // the on-screen report — not the no-op `activationType`. Distinct from Order Method
  // (the gateway).
  { header: "Activation Type", get: (r) => r.paymentMethod ?? "" },
  { header: "Promoter Name", get: (r) => r.promoterName ?? "" },
  { header: "Promocode", get: (r) => r.promocode ?? "" },
  { header: "Remarks", get: (r) => r.remarks ?? "" },
  { header: "Payment Id", get: (r) => r.razorpayPaymentId ?? "" },
  { header: "Order ID", get: (r) => r.razorpayOrderId ?? "" },
  { header: "Bank Transaction Id", get: (r) => r.bankTransactionId ?? "" },
  { header: "WS Coin", get: (r) => r.wsCoin ?? "" },
  { header: "Course Amount", get: (r) => r.courseAmount ?? "" },
  { header: "Material Amount", get: (r) => r.materialAmount ?? "" },
  { header: "Amount", get: (r) => r.amount ?? "" },
  { header: "Activated By", get: (r) => r.activatedBy ?? "" },
];

export const buildCourseSubscriptionsCsv = async (q: CourseSubReportQuery): Promise<string> => {
  const now = new Date();
  async function* rowBatches() {
    for await (const batch of iterateCourseSubExportRows(q, now)) {
      yield batch.map((r) => REPORT_EXPORT_COLUMNS.map((c) => c.get(r)));
    }
  }
  return buildCsvFromRowBatches(REPORT_EXPORT_COLUMNS.map((c) => c.header), rowBatches());
};

export const buildCourseSubscriptionsXlsx = async (q: CourseSubReportQuery): Promise<Buffer> => {
  const now = new Date();
  // Streaming workbook writer: rows are flushed to the stream as they are added
  // (worksheet model isn't kept in memory), so a 300k-row export stays bounded.
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  const finished = new Promise<void>((resolve, reject) => {
    pass.once("end", resolve);
    pass.once("error", reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet("Subscriptions");
  ws.columns = REPORT_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 22 }));
  for await (const batch of iterateCourseSubExportRows(q, now)) {
    for (const r of batch) ws.addRow(REPORT_EXPORT_COLUMNS.map((c) => c.get(r))).commit();
  }
  ws.commit();
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
};

// Streamed export source (async job path): same rows/columns as the sync builders, as a
// header + row-batch iterable the worker pipes straight into a multipart upload. See
// utils/reportStream.ts.
export function courseSubExportSource(q: CourseSubReportQuery): ReportSource {
  const now = new Date();
  return {
    worksheetName: "Subscriptions",
    headers: REPORT_EXPORT_COLUMNS.map((c) => c.header),
    rowBatches: (async function* () {
      for await (const batch of iterateCourseSubExportRows(q, now)) {
        yield batch.map((r) => REPORT_EXPORT_COLUMNS.map((c) => c.get(r)));
      }
    })(),
    // Exact total (same filters as the export) so the async job reports true
    // rowsWritten/total progress. Runs once, before streaming.
    countTotal: async () => {
      const resolved = await resolveCourseSubWhere(q, now);
      return resolved ? repo.countSubs(resolved.listWhere) : 0;
    },
  };
}

export const getCourseSubscriptionById = async (id: number): Promise<"not_found" | any> => {
  const r = await repo.findCourseSubById(id);
  if (!r) return "not_found";
  const [cust] = r.customerId ? await repo.customersByIds([r.customerId]) : [undefined];
  const [course] = r.courseId ? await repo.coursesByIds([r.courseId]) : [undefined];
  const [pkg] = r.packageId ? await repo.packagesByIds([r.packageId]) : [undefined];
  const [plan] = r.planId ? await repo.plansByIds([r.planId]) : [undefined];
  // Gateway refs and the order type live on ws_package_course_order. Admin-granted subs
  // often carry no order_id, so these stay null for them rather than being faked.
  const [order] = r.orderId ? await repo.ordersByIds([r.orderId]) : [undefined];
  return {
    _id: String(r.id),
    customerId: customerRef(cust),
    courseId: course ? { _id: String(course.id), name: course.name, image: course.image ?? null } : idStr(r.courseId),
    packageId: pkg ? { _id: String(pkg.id), name: pkg.name, image: pkg.image ?? null } : idStr(r.packageId),
    planId: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: plan.price } : idStr(r.planId),
    paidAmount: r.amount != null ? Number(r.amount) : 0,
    startAt: r.startAt ?? null, endAt: r.endAt ?? null,
    // payment_type is the activation channel (backend / app / web); order.paymentMethod
    // is the gateway. Both are surfaced — they answer different questions.
    status: r.status, paymentMethod: r.payment_type ?? null, remark: r.remarks ?? null,
    orderType: order?.orderType ?? null,
    orderPaymentMethod: order?.paymentMethod ?? null,
    razorpayOrderId: order?.gatewayOrderId ?? null,
    razorpayPaymentId: order?.gatewayPaymentId ?? null,
    bankTransactionId: order?.bankTransactionId ?? null,
    withMaterial: rowHasMaterial(r),
    trackingId: trackingToNumber(r.trackingId),
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  };
};

// Date/status/shipping columns are patched on ws_package_course_subscription; payment
// fields (method + reference ids) live on the linked ws_package_course_order and are
// patched there. The subscription only carries `payment_type` (the activation channel).
export const updateCourseSubscription = async (
  id: number,
  patch: {
    startAt?: Date; endAt?: Date; status?: boolean;
    shippingId?: number | null; trackingId?: bigint | null; remark?: string;
    actingAdminId?: number | null;
    // Payment correction — written to the linked order row.
    paymentMethod?: string;
    bankTransactionId?: string | null;
    razorpayOrderId?: string | null;
    razorpayPaymentId?: string | null;
  }
): Promise<"not_found" | "no_order" | any> => {
  const existing = await repo.findCourseSubById(id);
  if (!existing) return "not_found";

  const touchesPayment =
    patch.paymentMethod !== undefined ||
    patch.bankTransactionId !== undefined ||
    patch.razorpayOrderId !== undefined ||
    patch.razorpayPaymentId !== undefined;

  // An order-less subscription has nowhere to record a payment method, so reject
  // rather than accept the edit and drop it.
  if (touchesPayment && existing.orderId == null) return "no_order";

  const changes: string[] = [];
  const track = (label: string, from: string, to: string) => {
    if (from !== to) changes.push(`${label} ${from || "none"} -> ${to || "none"}`);
  };

  if (patch.startAt !== undefined) track("start date", fmtExportDate(existing.startAt), fmtExportDate(patch.startAt));
  if (patch.endAt !== undefined) track("end date", fmtExportDate(existing.endAt), fmtExportDate(patch.endAt));
  if (patch.status !== undefined) track("status", activeLabel(existing.status), activeLabel(patch.status));
  if (patch.shippingId !== undefined) track("shipping", idStr(existing.shippingId) ?? "", idStr(patch.shippingId) ?? "");
  if (patch.trackingId !== undefined) track("tracking", existing.trackingId?.toString() ?? "", patch.trackingId?.toString() ?? "");

  if (touchesPayment) {
    const [order] = await repo.ordersByIds([existing.orderId as number]);
    if (patch.paymentMethod !== undefined) track("payment method", String(order?.paymentMethod ?? ""), patch.paymentMethod);
    if (patch.bankTransactionId !== undefined) track("bank transaction id", order?.bankTransactionId ?? "", patch.bankTransactionId ?? "");
    if (patch.razorpayOrderId !== undefined) track("razorpay order id", order?.gatewayOrderId ?? "", patch.razorpayOrderId ?? "");
    if (patch.razorpayPaymentId !== undefined) track("razorpay payment id", order?.gatewayPaymentId ?? "", patch.razorpayPaymentId ?? "");
  }

  const now = new Date();
  const hasHistoryEntry = changes.length > 0 || !!patch.remark?.trim();
  const remarks = hasHistoryEntry
    ? await withHistory(existing.remarks, changes.length ? `Updated: ${changes.join("; ")}` : "", patch, now)
    : undefined;

  await repo.patchSub(id, {
    startAt: patch.startAt,
    endAt: patch.endAt,
    status: patch.status,
    shippingId: patch.shippingId,
    trackingId: patch.trackingId,
    remarks,
    actingAdminId: patch.actingAdminId ?? null,
    now,
  });

  if (touchesPayment) {
    await repo.patchOrderPayment(existing.orderId as number, {
      paymentMethod: patch.paymentMethod,
      bankTransactionId: patch.bankTransactionId,
      razorpayOrderId: patch.razorpayOrderId,
      razorpayPaymentId: patch.razorpayPaymentId,
      now,
    });
  }

  return getCourseSubscriptionById(id);
};

type HistoryInput = { remark?: string | null; actingAdminId?: number | null };

// A transfer that overlaps an active subscription of the same product is held until the
// admin confirms the queued dates (`confirmDates`), then applied with them.
type TransferInput = HistoryInput & { confirmDates?: boolean };

type Product = { courseId: number | null; packageId: number | null };

const activeLabel = (status: boolean | null | undefined): string => (status ? "active" : "inactive");

const withHistory = (remarks: string | null, what: string, input: HistoryInput, now: Date): Promise<string> =>
  appendAdminRemark(remarks, { what, remark: input.remark, actingAdminId: input.actingAdminId, now }, repo.adminUsersByIds);

const productOf = (row: { courseId: number | null; packageId: number | null }): Product => ({
  courseId: row.courseId ?? null,
  packageId: row.courseId ? null : row.packageId ?? null,
});

const productLabel = async ({ courseId, packageId }: Product): Promise<string> => {
  if (courseId) {
    const [course] = await repo.coursesByIds([courseId]);
    return `Course "${course?.name ?? ""}" (#${courseId})`;
  }
  if (packageId) {
    const [pkg] = await repo.packagesByIds([packageId]);
    return `Package "${pkg?.name ?? ""}" (#${packageId})`;
  }
  return "none";
};

// Which per-type permission key (customers.<kind>-subscriptions.*) a row's actions need.
export const getSubscriptionKind = async (id: number): Promise<"course" | "package" | null> => {
  const row = await repo.findCourseSubById(id);
  if (!row) return null;
  return row.courseId ? "course" : row.packageId ? "package" : null;
};

export type ChangeProductResult =
  | { ok: false; reason: "not_found" | "target_not_found" | "same_target" }
  | { ok: false; reason: "needs_confirmation"; dateShift: DateShift }
  | { ok: true; customerId: number | null; data: any };

export const changeSubscriptionProduct = async (
  id: number,
  input: TransferInput & { courseId?: number; packageId?: number }
): Promise<ChangeProductResult> => {
  const existing = await repo.findCourseSubById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const current = productOf(existing);
  const target = productOf({ courseId: input.courseId ?? null, packageId: input.packageId ?? null });
  const { courseId, packageId } = target;

  const targetRows = courseId ? await repo.coursesByIds([courseId]) : await repo.packagesByIds([packageId as number]);
  if (!targetRows.length) return { ok: false, reason: "target_not_found" };
  if (current.courseId === courseId && current.packageId === packageId) return { ok: false, reason: "same_target" };

  const [fromLabel, toLabel] = await Promise.all([productLabel(current), productLabel(target)]);
  const changed = `Course/package changed: ${fromLabel} -> ${toLabel}`;

  const now = new Date();
  const dateShift = existing.customerId
    ? planDateShift(existing, await repo.activeSubsForTarget(existing.customerId, target, now), now)
    : null;
  if (dateShift && !input.confirmDates) return { ok: false, reason: "needs_confirmation", dateShift };
  const what = dateShift ? `${changed}. ${dateShift.what}` : changed;

  await repo.patchSub(id, {
    courseId,
    packageId,
    ...(dateShift ? { startAt: dateShift.startAt, endAt: dateShift.endAt } : {}),
    remarks: await withHistory(existing.remarks, what, input, now),
    actingAdminId: input.actingAdminId ?? null,
    now,
  });

  return { ok: true, customerId: existing.customerId ?? null, data: await getCourseSubscriptionById(id) };
};

export type MoveSubscriptionResult =
  | { ok: false; reason: "not_found" | "customer_not_found" | "same_customer" }
  | { ok: false; reason: "needs_confirmation"; dateShift: DateShift }
  | { ok: true; fromCustomerId: number | null; toCustomerId: number; data: any };

export const moveSubscription = async (
  id: number,
  input: TransferInput & { customerId: number }
): Promise<MoveSubscriptionResult> => {
  const existing = await repo.findCourseSubById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const target = await repo.findLiveCustomer(input.customerId);
  if (!target) return { ok: false, reason: "customer_not_found" };
  if (existing.customerId === target.id) return { ok: false, reason: "same_customer" };

  const fromCustomerId = existing.customerId ?? null;
  const [source] = fromCustomerId ? await repo.customersByIds([fromCustomerId]) : [];
  const moved = movedRemarkText(
    { id: fromCustomerId, phone: source?.phoneNumber },
    { id: target.id, phone: target.phoneNumber }
  );

  const now = new Date();
  const targetActives = await repo.activeSubsForTarget(target.id, productOf(existing), now);
  const dateShift = planDateShift(existing, targetActives, now);
  if (dateShift && !input.confirmDates) return { ok: false, reason: "needs_confirmation", dateShift };
  const newDates = dateShift ?? planQueuedStart(existing, targetActives, now);
  const orderId = existing.orderId && (await repo.orderOwnedOnlyBy(existing.orderId, id)) ? existing.orderId : null;
  const what = [moved, orderId && `Order #${orderId} moved with it`, newDates?.what].filter(Boolean).join(". ");

  const subUpdate = repo.patchSub(id, {
    customerId: target.id,
    ...(newDates ? { startAt: newDates.startAt, endAt: newDates.endAt } : {}),
    remarks: await withHistory(existing.remarks, what, input, now),
    actingAdminId: input.actingAdminId ?? null,
    now,
  });
  if (orderId) await repo.transaction([subUpdate, repo.setOrderCustomer(orderId, target.id)]);
  else await subUpdate;

  return { ok: true, fromCustomerId, toCustomerId: target.id, data: await getCourseSubscriptionById(id) };
};

export type DeactivateSubscriptionResult =
  | { ok: false; reason: "not_found" | "already_deactivated" }
  | { ok: true; customerId: number | null; data: any };

export const deactivateSubscription = async (
  id: number,
  input: HistoryInput
): Promise<DeactivateSubscriptionResult> => {
  const existing = await repo.findCourseSubById(id);
  if (!existing || (!existing.courseId && !existing.packageId)) return { ok: false, reason: "not_found" };

  const now = new Date();
  const deactivation = planDeactivation(existing, now);
  if (!deactivation) return { ok: false, reason: "already_deactivated" };

  await repo.patchSub(id, {
    endAt: deactivation.endAt,
    status: deactivation.status,
    remarks: await withHistory(existing.remarks, deactivation.what, input, now),
    actingAdminId: input.actingAdminId ?? null,
    now,
  });

  return { ok: true, customerId: existing.customerId ?? null, data: await getCourseSubscriptionById(id) };
};

export type RevertDeactivationResult =
  | { ok: false; reason: "not_found" | "no_record" | "not_deactivated" }
  | { ok: true; customerId: number | null; data: any };

export const revertSubscriptionDeactivation = async (
  id: number,
  input: HistoryInput
): Promise<RevertDeactivationResult> => {
  const existing = await repo.findCourseSubById(id);
  if (!existing || (!existing.courseId && !existing.packageId)) return { ok: false, reason: "not_found" };

  const revert = planDeactivationRevert(existing);
  if (!revert.ok) return revert;

  const now = new Date();
  await repo.patchSub(id, {
    endAt: revert.endAt,
    status: revert.status,
    remarks: await withHistory(existing.remarks, revert.what, input, now),
    actingAdminId: input.actingAdminId ?? null,
    now,
  });

  return { ok: true, customerId: existing.customerId ?? null, data: await getCourseSubscriptionById(id) };
};

export type AddDaysResult =
  | { ok: false; reason: "not_found" }
  | { ok: true; customerId: number | null; data: any };

export const addSubscriptionDays = async (id: number, input: HistoryInput & { days: number }): Promise<AddDaysResult> => {
  const existing = await repo.findCourseSubById(id);
  if (!existing || (!existing.courseId && !existing.packageId)) return { ok: false, reason: "not_found" };

  const now = new Date();
  const addition = planAddDays(existing, input.days, now);

  await repo.patchSub(id, {
    endAt: addition.endAt,
    remarks: await withHistory(existing.remarks, addition.what, input, now),
    actingAdminId: input.actingAdminId ?? null,
    now,
  });

  return { ok: true, customerId: existing.customerId ?? null, data: await getCourseSubscriptionById(id) };
};

export const getSubscriptionHistory = async (id: number): Promise<"not_found" | any> => {
  const subscription = await repo.findCourseSubById(id);
  if (!subscription) return "not_found";

  const { created_by: createdById, updated_by: updatedById, customerId } = subscription;
  const [admins, customers, product] = await Promise.all([
    repo.adminUsersByIds([createdById, updatedById].filter((x): x is number => x != null && x > 0)),
    customerId ? repo.customersByIds([customerId]) : Promise.resolve([]),
    productLabel(productOf(subscription)),
  ]);

  const adminRef = (adminId: number | null) => {
    if (adminId == null) return null;
    const admin = admins.find((a) => Number(a.id) === adminId);
    return { _id: String(adminId), name: admin ? adminDisplayName(admin) || null : null };
  };

  return {
    _id: String(subscription.id),
    customerId: customerRef(customers[0]),
    courseId: idStr(subscription.courseId),
    packageId: idStr(productOf(subscription).packageId),
    product,
    createdAt: subscription.createdAt ?? null,
    createdBy: adminRef(createdById),
    updatedAt: subscription.updatedAt ?? null,
    updatedBy: adminRef(updatedById),
    history: parseRemarkHistory(subscription.remarks),
  };
};


/**
 * The customer owning this subscription, or null. Read before an admin revoke (status
 * flip / date change / delete) so the caller can flush that customer's per-user route
 * cache — after a delete the owner can no longer be resolved.
 */
export const getSubscriptionCustomerId = async (id: number): Promise<number | null> =>
  (await repo.findSubscriptionCustomerId(id))?.customerId ?? null;

export const deleteCourseSubscription = async (id: number): Promise<boolean> => {
  if (!(await repo.findCourseSubById(id))) return false;
  await repo.deleteSub(id);
  return true;
};

// No payment_status column (status conveys active), so `withMaterial` is reflected via
// `material_amount` (not a pc_material_id row) and `customerShippingId` is stored in the
// `shipping` column as given.
export interface CreateCourseSubInput {
  customerId: number;
  courseId?: number | null;
  packageId?: number | null;
  // Optional: when absent, `amount` is the paid amount and `durationDays` drives
  // the window (no plan lookup) — see createCourseSubscription below.
  planId?: number | null;
  withMaterial: boolean;
  paymentType: "backend" | "online";
  // Granular payment method (cash/bank/razorpay/free/…) + reference ids, persisted
  // on the linked ws_package_course_order row (the report reads ids from there).
  paymentMethod?: string;
  bankTransactionId?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  amount?: number;
  durationDays?: number;
  startAt?: string;
  customerShippingId?: number | null;
  remark?: string | null;
  status: boolean;
  // extend=true → a new subscription row that continues from the customer's existing
  // active sub for this target (starts at its end date, floored at now); the prior row
  // is untouched. No active sub → a fresh grant starting now.
  extend?: boolean;
  // Acting admin id (resolved server-side from the JWT) → stamped on created_by +
  // updated_by (an extend also creates a new row).
  actingAdminId?: number | null;
}

export type CreateCourseSubResult =
  | { ok: false; reason: "plan_not_found" | "course_mismatch" | "package_mismatch" | "shipping_required" | "shipping_invalid" }
  | { ok: true; extended: boolean; data: any };

// Admin grant or extend: always writes a new order and a new subscription row.
export const createCourseSubscription = async (input: CreateCourseSubInput): Promise<CreateCourseSubResult> => {
  // planId is optional: with a plan we derive price/duration from it (and validate
  // the course/package match); without one the grant is priced by `amount` and
  // dated by `durationDays` (the caller/validation guarantees durationDays here).
  const plan = input.planId != null ? await repo.findPlanById(input.planId) : null;
  if (input.planId != null && !plan) return { ok: false, reason: "plan_not_found" };
  if (plan && input.courseId && Number(plan.courseId ?? 0) !== input.courseId) return { ok: false, reason: "course_mismatch" };
  if (plan && input.packageId && Number(plan.packageId ?? 0) !== input.packageId) return { ok: false, reason: "package_mismatch" };
  if (input.withMaterial && !input.customerShippingId) return { ok: false, reason: "shipping_required" };

  // The admin form posts an address-book id (ws_customer_address). Both rows written
  // below key their shipping column to ws_customer_shipping, so snapshot the address
  // into a real shipping row first and use that id for the order and the subscription.
  let shippingIdSql: number | null = null;
  if (input.customerShippingId) {
    const resolved = await resolveShippingIdForAddress(input.customerId, input.customerShippingId);
    if (!resolved.ok) return { ok: false, reason: "shipping_invalid" };
    shippingIdSql = resolved.shippingId;
  }

  const resolvedCourseId = input.courseId || plan?.courseId || null;
  const resolvedPackageId = input.packageId || plan?.packageId || null;
  const computedAmount =
    input.amount != null ? input.amount : (plan?.price || 0) + (input.withMaterial ? (plan?.materialPrice || 0) : 0);
  const now = new Date();

  // Order row carrying the payment method + reference ids + amount, written for fresh
  // grants and extends alike; the report reads these back via the sub's order_id.
  const makeOrder = () =>
    repo.createPaymentOrder({
      customerId: input.customerId,
      planId: plan?.id ?? null,
      shippingId: shippingIdSql,
      amount: Math.round(computedAmount),
      paymentMethod: input.paymentMethod ?? "cash",
      razorpayOrderId: input.razorpayOrderId ?? null,
      razorpayPaymentId: input.razorpayPaymentId ?? null,
      bankTransactionId: input.bankTransactionId ?? null,
      now,
    });

  // Extend: recorded as a new subscription row tied to its own order (one line per
  // extension in the report) rather than bumping endAt in place. The new row continues
  // from the prior plan's end date for seamless coverage; if that date has passed — or
  // the admin passed an explicit startAt — it starts at that/now instead of backdating.
  const existing =
    input.extend && (resolvedCourseId || resolvedPackageId)
      ? await repo.findActiveSubForTarget({ customerId: input.customerId, courseId: resolvedCourseId, packageId: resolvedPackageId })
      : null;
  const wasExtension = !!existing;

  const startAt = input.startAt
    ? new Date(input.startAt)
    : existing?.endAt && existing.endAt > now
      ? existing.endAt
      : now;
  const endAt =
    input.durationDays && input.durationDays > 0
      ? computeEndAt({ startAt, durationMonths: input.durationDays, asDays: true })
      : computeEndAt({ startAt, durationMonths: plan?.duration || 0, asDays: true });

  const order = await makeOrder();

  // Course/material money split — same rule as checkout (commerce-order.computeMaterialSplit):
  // material is carved out of the granted amount, course takes the rest (floored at ₹100),
  // and the two always sum to `amount`. For a plan-priced grant this equals
  // price/materialPrice; when the admin overrides `amount`, course_amount can never
  // exceed what was actually granted.
  const grantSplit = computeMaterialSplit(computedAmount, {
    withMaterial: input.withMaterial,
    materialPrice: plan?.materialPrice ?? 0,
  });

  const created = await repo.createSub({
    customerId: input.customerId,
    orderId: order.id,
    courseId: resolvedCourseId,
    packageId: resolvedPackageId,
    planId: plan?.id ?? null,
    shippingId: shippingIdSql,
    startAt,
    endAt,
    status: input.status,
    amount: computedAmount,
    courseAmount: grantSplit.courseAmount,
    materialAmount: grantSplit.materialAmount,
    payment_type: input.paymentType,
    remarks: input.remark ?? null,
    actingAdminId: input.actingAdminId ?? null,
    now,
  });
  return { ok: true, extended: wasExtension, data: await getCourseSubscriptionById(created.id) };
};

/**
 * Pricing plans for one course or package (Add-Subscription picker).
 *
 * `status`: true = active only, false = inactive only, undefined = both. The controller
 * defaults an absent `?status=` to `true`, which the customer-facing app relies on
 * (it must never see inactive plans).
 *
 * `updatedAt` matches the live-course / test-series / ebook plan DTOs; the admin picker
 * ages inactive plans by it. It is `updated_at`, not a deactivated-at — a plan switched
 * off months ago but renamed yesterday looks recent (no table has a deactivated-at).
 */
export const listPlansForTarget = async (courseId?: number, packageId?: number, status?: boolean) => {
  const plans = await repo.plansForTarget({ courseId, packageId, status });
  return plans.map((p) => ({ _id: String(p.id), name: p.name ?? null, duration: p.duration, price: p.price, materialPrice: p.materialPrice ?? 0, withMaterial: p.withMaterial, isDefault: p.isDefault, status: p.status, courseId: idStr(p.courseId), packageId: idStr(p.packageId), updatedAt: p.updated_at ?? null }));
};

export const listEbookSubscriptions = async (q: { customerId?: string; ebookId?: string; status?: string; fromDate?: string; toDate?: string; page: number; limit: number }) => {
  const opts = {
    customerId: q.customerId ? parseSubId(q.customerId) ?? undefined : undefined,
    ebookId: q.ebookId ? parseSubId(q.ebookId) ?? undefined : undefined,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
    fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
    toDate: q.toDate ? new Date(q.toDate) : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listEbookSubs({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countEbookSubs(opts),
  ]);
  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const ebooks = new Map((await repo.ebooksByIds([...new Set(rows.map((r) => r.ebookId).filter((x): x is number => x != null && x > 0))])).map((e) => [e.id, e]));
  const data = rows.map((r) => ({
    _id: String(r.id),
    customerId: customerRef(r.customerId ? custs.get(r.customerId) : undefined),
    ebookId: r.ebookId && ebooks.get(r.ebookId) ? { _id: String(r.ebookId), name: ebooks.get(r.ebookId)!.name, author: ebooks.get(r.ebookId)!.author ?? null } : idStr(r.ebookId),
    price: r.price != null ? Number(r.price) : 0,
    startAt: r.startAt ?? null, endAt: r.endAt ?? null, status: r.status,
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  }));
  return { data, pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) } };
};

const dateWhere = (fromDate?: string, toDate?: string) => {
  if (!fromDate && !toDate) return {};
  const createdAt: any = {};
  if (fromDate) createdAt.gte = new Date(fromDate);
  if (toDate) createdAt.lte = new Date(toDate);
  return { createdAt };
};

// Totals for course/ebook subscriptions plus ebook and book order revenue.
export const reportSummary = async (fromDate?: string, toDate?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const [totalCourse, activeCourse, totalEbook, activeEbook, ebookRev, bookRev, bookTotal] = await Promise.all([
    repo.countSubs(dw),
    repo.countSubs({ ...dw, status: true }),
    repo.countEbookSubsRaw(dw),
    repo.countEbookSubsRaw({ ...dw, status: true }),
    repo.ebookOrderRevenue({ status: "complete" as any, ...dw }),
    repo.bookOrderRevenue({ status: "verified", ...dw }),
    repo.countBookOrders(dw),
  ]);
  const ebookRevenue = ebookRev._sum.orderPrice ?? 0;
  const bookRevenue = bookRev._sum.amount != null ? Number(bookRev._sum.amount) : 0;
  return {
    courseSubscriptions: { total: totalCourse, active: activeCourse },
    ebookSubscriptions: { total: totalEbook, active: activeEbook, revenue: ebookRevenue, orderCount: ebookRev._count._all },
    bookOrders: { total: bookTotal, verifiedCount: bookRev._count._all, revenue: bookRevenue },
    totalRevenue: ebookRevenue + bookRevenue,
  };
};

export const reportByCourse = async (fromDate?: string, toDate?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const [totals, actives] = await Promise.all([
    repo.subsByCourse({ ...dw, courseId: { gt: 0 } }),
    repo.subsByCourseActive({ ...dw, courseId: { gt: 0 } }),
  ]);
  const activeBy = new Map(actives.map((a) => [a.courseId, a._count._all]));
  const courseIds = totals.map((t) => t.courseId).filter((x): x is number => x != null);
  const courses = new Map((await repo.coursesByIds(courseIds)).map((c) => [c.id, c]));
  return totals
    .map((t) => ({
      _id: idStr(t.courseId),
      course: t.courseId && courses.get(t.courseId) ? { _id: String(t.courseId), name: courses.get(t.courseId)!.name, image: courses.get(t.courseId)!.image ?? null } : null,
      totalSubscriptions: t._count._all,
      activeSubscriptions: activeBy.get(t.courseId) ?? 0,
    }))
    .sort((a, b) => b.totalSubscriptions - a.totalSubscriptions);
};

export const reportByEbook = async (fromDate?: string, toDate?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const [grp, actives] = await Promise.all([
    repo.ebookSubsByEbook(dw),
    repo.ebookSubsByEbookActive(dw),
  ]);
  const activeBy = new Map(actives.map((a) => [a.ebookId, a._count._all]));
  const ebookIds = grp.map((g) => g.ebookId).filter((x): x is number => x != null);
  const ebooks = new Map((await repo.ebooksByIds(ebookIds)).map((e) => [e.id, e]));
  return grp
    .map((g) => ({
      _id: idStr(g.ebookId),
      ebook: g.ebookId && ebooks.get(g.ebookId) ? { _id: String(g.ebookId), name: ebooks.get(g.ebookId)!.name, author: ebooks.get(g.ebookId)!.author ?? null } : null,
      totalSubscriptions: g._count._all,
      activeSubscriptions: activeBy.get(g.ebookId) ?? 0,
      revenue: g._sum.price != null ? Number(g._sum.price) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
};

export const reportBookOrders = async (fromDate?: string, toDate?: string, status?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const grp = await repo.bookOrdersByStatus({ ...dw, ...(status ? { status } : {}) });
  return grp.map((g) => ({ _id: g.status, count: g._count._all, revenue: g._sum.amount != null ? Number(g._sum.amount) : 0 }));
};
