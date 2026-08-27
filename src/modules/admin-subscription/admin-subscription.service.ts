import ExcelJS from "exceljs";
import { resolveShippingIdForAddress } from "../customer-shipping/customer-shipping.service";
import type { ReportSource } from "../../utils/reportStream";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { computeEndAt } from "../../utils/planDuration";
import { adminSubscriptionRepository as repo } from "./admin-subscription.repository";
import { computeMaterialSplit } from "../commerce-order/commerce-order.service";
import { andWhere, statusWhere, normalizeStatus, reportRow, blankStrToNull, decToNum, rowHasMaterial, trackingToNumber } from "../../utils/reportFilters";
import { PaymentMethod } from "../../shared/enums";

// Report `orderMethod` filter = the payment GATEWAY (order.payment_method), distinct
// from `paymentMethod` (= payment_type online|backend, the activation channel). FE
// sends lowercase; map to the canonical enum value (Paykun/Paytm are capitalized).
const GATEWAY_BY_INPUT: Record<string, string> = {
  razorpay: PaymentMethod.RAZORPAY, bank: PaymentMethod.BANK, cash: PaymentMethod.CASH,
  free: PaymentMethod.FREE, paykun: PaymentMethod.PAYKUN, paytm: PaymentMethod.PAYTM,
};

export const ADMIN_SUBSCRIPTION_MODULE = "admin-subscription";
export const isAdminSubscriptionMysql = (): boolean => true;

export const parseSubId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStr = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);

// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to →
// 23:59:59.999 at Asia/Kolkata, +05:30). The admin picks a calendar date in IST, so
// a naive local/UTC parse would drop the last 5.5h of the day — pin the offset.
// Full timestamps pass through as-is. Invalid → undefined (no bound).
const parseDayBound = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`) : new Date(s);
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

// blankStrToNull / decToNum / rowHasMaterial / trackingToNumber moved to
// utils/reportFilters on 2026-08-27 — the Live Course report emits the same columns
// and the two must not drift. Imported above.
const customerRef = (c: { id: number; fullName: string | null; phoneNumber: string; emailAddress?: string | null } | undefined) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber, ...(c.emailAddress !== undefined ? { emailAddress: c.emailAddress ?? null } : {}) };
};

// ── course/package subscription list + export (Reports contract) ─────────────
// Shared contract across the 4 admin subscription reports — see
// docs/REPORTS_SUBSCRIPTIONS_ADMIN.md. list() returns { summary, data,
// pagination } (summary respects all filters, ignores pagination); the SAME
// filters drive the CSV/Excel export (which ignores pagination entirely).
// `status` is the normalized active|expired|inactive; paymentMethod is the
// coarse online|backend (= payment_type). Date ranges are independent:
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
  // Accepted so the FE param is honored once a source exists; there is no SQL
  // column for Activation Type yet (see backend-request), so it is a no-op today.
  activationType?: string;
  search?: string; sortBy?: string; sortOrder?: string; type?: string;
}

// Resolve the composed Prisma where (base filters AND normalized status) for a
// report query. Returns null when a search matched nothing (→ empty result).
const resolveCourseSubWhere = async (q: CourseSubReportQuery, now: Date) => {
  let customerIdsIn: number[] | undefined, courseIdsIn: number[] | undefined, packageIdsIn: number[] | undefined;
  if (q.search) {
    [customerIdsIn, courseIdsIn, packageIdsIn] = await Promise.all([
      repo.customerIdsByText(q.search), repo.courseIdsByText(q.search), repo.packageIdsByText(q.search),
    ]);
    if (!customerIdsIn.length && !courseIdsIn.length && !packageIdsIn.length) return null;
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
    customerIdsIn, courseIdsIn, packageIdsIn,
  });
  const listWhere = andWhere(base, statusWhere(q.status, now));
  const sortBy = q.sortBy ?? "createdAt";
  const sortDir = (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc";
  return { listWhere, sortBy, sortDir };
};

// Hydrate raw subscription rows into the report DTO (shared by list + export).
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
      status: normalizeStatus({ status: r.status, endAt: r.endAt }, now),
      startAt: r.startAt ?? null, endAt: r.endAt ?? null, createdAt: r.createdAt ?? null,
    });
    const adminName = admin ? `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() : "";
    const promocode = order ? promoCodeOf(order.promocode) : null;
    return {
      id: r.id,
      ...base,
      // courier tracking (set via subscriptions /tracking PATCH); null until assigned
      trackingId: trackingToNumber(r.trackingId),
      // people (+ ids so the report can link to each detail page)
      educatorName: educator?.name ?? null,
      educatorId: educator?.id ?? null,
      promoterName: promoter?.full_name ?? null,
      promoterId: promoter?.id ?? null,
      promocode,
      promocodeId: promocode ? promocodeIds.get(promocode) ?? null : null,
      // amounts / coins
      courseAmount: decToNum(r.courseAmount),
      materialAmount: decToNum(r.materialAmount),
      wsCoin: order?.wsCoin ?? null,
      // Payment gateway from the linked order (razorpay|bank|cash|free|paykun|paytm),
      // lowercased to match the orderMethod filter values; null when there's no order.
      orderMethod: order?.paymentMethod ? String(order.paymentMethod).toLowerCase() : null,
      materialType: rowHasMaterial(r) ? "With Material" : "Without Material",
      // NOTE: no SQL source for "Activation Type" — see backend-request open item.
      activationType: null as string | null,
      // gateway / payment ids
      razorpayOrderId: order ? blankStrToNull(order.gatewayOrderId) : null,
      razorpayPaymentId: order ? blankStrToNull(order.gatewayPaymentId) : null,
      bankTransactionId: order ? blankStrToNull(order.bankTransactionId) : null,
      // shipping (report only needs address/city/pincode + alternate phone)
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

// ── report export (CSV / Excel) ──────────────────────────────────────────────
// Same filters as the list, but the ENTIRE filtered set (no pagination) and NO
// row cap — a 300k-row filter must export every matching row. We page the result
// set in keyset batches (id DESC ≈ the createdAt-DESC default, no deep OFFSET) and
// hydrate one batch at a time, so memory stays bounded per batch instead of
// loading the whole result set at once. Both formats share one column spec so
// they stay in lockstep, and the async export job reuses these same builders.
const EXPORT_BATCH = 5_000;

async function* iterateCourseSubExportRows(q: CourseSubReportQuery, now: Date) {
  const resolved = await resolveCourseSubWhere(withListDateDefaults(q), now);
  if (!resolved) return;
  const { listWhere } = resolved;
  let beforeId: number | undefined;
  for (;;) {
    const rows = await repo.listCourseSubsPageKeyset(listWhere, beforeId, EXPORT_BATCH);
    if (!rows.length) break;
    yield await hydrateCourseSubRows(rows, now);
    if (rows.length < EXPORT_BATCH) break;
    beforeId = rows[rows.length - 1].id;
  }
}

// Timestamps render as IST (Asia/Kolkata, UTC+5:30, no DST) in `YYYY-MM-DD HH:mm:ss`
// 24-hour form, e.g. "2026-10-06 00:01:21" (was a raw UTC ISO string). Shift the
// instant by +5:30 and read the wall-clock parts off the shifted value.
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtExportDate = (d: Date | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
};
// Column order: the client's Subscription-WithMaterial-Report.csv set first, then
// the extra columns the on-screen report shows. A row is either a course OR a
// package, so only the matching name column is filled.
const REPORT_EXPORT_COLUMNS: { header: string; get: (r: any) => string | number }[] = [
  { header: "Created At", get: (r) => fmtExportDate(r.createdAt) },
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
  // Activation Type = how the sub was activated (online | backend). Sourced from
  // the row's `paymentMethod` (= ws_package_course_subscription.payment_type), the
  // same field the on-screen report maps to its Activation Type column — NOT the
  // no-op `activationType` (which has no SQL source). Distinct from Order Method
  // (the payment gateway). See docs/backend-requests/subscription-report-filters.md.
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

// Streamed export source (async job path). Same rows/columns as the sync builders
// above, but exposed as a header + row-batch iterable so the worker can pipe it
// straight into a multipart upload — no full-file buffer. See utils/reportStream.ts.
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
  // The gateway refs and the order type live on ws_package_course_order, not on the
  // subscription. Admin-granted subs carry no order_id (12k of package 91's 48k rows),
  // so these stay null for them rather than being faked.
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
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  };
};

// ── course/package subscription update / delete (admin edit) ─────────────────
// Date/status/shipping columns are patched on ws_package_course_subscription; the
// PAYMENT fields (method + reference ids) live on the linked
// ws_package_course_order and are patched there. The subscription itself carries
// only `payment_type` (backend|online) — the activation channel, not a method.
export const updateCourseSubscription = async (
  id: number,
  patch: {
    startAt?: Date; endAt?: Date; status?: boolean;
    shippingId?: number | null; trackingId?: bigint | null; remark?: string;
    actingAdminId?: number | null;
    // Payment correction — written to the linked order row (2026-08-21).
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

  // A legacy order-less subscription has nowhere to record a payment method, so
  // say so rather than accepting the edit and dropping it — the exact failure this
  // change exists to remove.
  if (touchesPayment && existing.orderId == null) return "no_order";

  const now = new Date();
  await repo.patchSub(id, {
    startAt: patch.startAt,
    endAt: patch.endAt,
    status: patch.status,
    shippingId: patch.shippingId,
    trackingId: patch.trackingId,
    remarks: patch.remark,
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


/**
 * The customer owning this subscription, or null if it doesn't exist.
 *
 * Read BEFORE an admin revoke (status flip / date change / delete) so the caller
 * can flush that customer's per-user route cache. On delete the row is gone
 * afterwards, so the id cannot be resolved after the mutation.
 */
export const getSubscriptionCustomerId = async (id: number): Promise<number | null> =>
  (await repo.findSubscriptionCustomerId(id))?.customerId ?? null;

export const deleteCourseSubscription = async (id: number): Promise<boolean> => {
  if (!(await repo.findCourseSubById(id))) return false;
  await repo.deleteSub(id);
  return true;
};

// ── course/package subscription create (admin manual grant) ──────────────────
// MySQL model divergence vs Mongo: SQL has no payment_status (status conveys
// active) and no material/shipping catalog wired into the admin form, so
// `withMaterial` is reflected via `material_amount` (not a pc_material_id row),
// and `customerShippingId` is stored in the `shipping` column as given.
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
  // extend=true → record a new subscription row that CONTINUES from the customer's
  // existing active subscription for this target (new row starts at the prior plan's
  // end date, floored at now); the prior row is left untouched. No existing active
  // sub → behaves as a fresh grant starting now.
  extend?: boolean;
  // Acting admin id (resolved server-side from the JWT) → stamped on created_by +
  // updated_by. An extend also creates a NEW row here, so both columns are set.
  actingAdminId?: number | null;
}

export type CreateCourseSubResult =
  | { ok: false; reason: "plan_not_found" | "course_mismatch" | "package_mismatch" | "shipping_required" | "shipping_invalid" }
  | { ok: true; extended: boolean; data: any };

export const createCourseSubscription = async (input: CreateCourseSubInput): Promise<CreateCourseSubResult> => {
  // planId is optional: with a plan we derive price/duration from it (and validate
  // the course/package match); without one the grant is priced by `amount` and
  // dated by `durationDays` (the caller/validation guarantees durationDays here).
  const plan = input.planId != null ? await repo.findPlanById(input.planId) : null;
  if (input.planId != null && !plan) return { ok: false, reason: "plan_not_found" };
  if (plan && input.courseId && Number(plan.courseId ?? 0) !== input.courseId) return { ok: false, reason: "course_mismatch" };
  if (plan && input.packageId && Number(plan.packageId ?? 0) !== input.packageId) return { ok: false, reason: "package_mismatch" };
  if (input.withMaterial && !input.customerShippingId) return { ok: false, reason: "shipping_required" };

  // The admin form posts an ADDRESS-BOOK id — the customer-details screen lists
  // ws_customer_address rows and nothing else. Both rows written below key their
  // shipping column to ws_customer_shipping, so snapshot the address into a real
  // shipping row first and use THAT id for the order and the subscription alike.
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

  // The order row carrying the granular payment method + reference ids + amount.
  // Written for both fresh grants and extends (an extend is still a paid txn); the
  // Subscription Report reads these ids back via the subscription's order_id.
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

  // Subscription Type = Extend: business rule — an extension is recorded as a NEW
  // subscription row tied to its own order (so each extension is its own line in the
  // Subscription Report, based on its order id) instead of bumping the existing
  // row's endAt in place. The prior subscription row is left untouched; the new row
  // CONTINUES from the prior plan's end date so coverage is seamless (no overlap, no
  // gap). If that end date is already in the past (the prior plan lapsed) — or the
  // admin passed an explicit startAt — we fall back to that/now instead of backdating.
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

  // Course/material money split — the SAME rule as the checkout path
  // (commerce-order.computeMaterialSplit), so course_amount obeys one definition no
  // matter who wrote the row: material is carved OUT of the granted amount, course
  // takes the rest, floored at ₹100, and the two always sum back to `amount`.
  //
  // For a plan-priced grant this is byte-identical to the previous
  // `courseAmount: plan.price` / `materialAmount: plan.materialPrice` — computedAmount
  // is price + materialPrice there, so subtracting material hands back exactly price.
  // It only changes the case that was wrong: when the admin OVERRIDES `amount` (a
  // discounted manual grant), course_amount used to stay at the full plan price and
  // could exceed what was actually granted — ₹6500 granted, ₹13000 booked to course.
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
 * `status`: true = active only, false = inactive only, undefined = both.
 * The CALLER decides — the controller defaults an absent `?status=` to `true`, so
 * today's "active only" behaviour is unchanged for every existing consumer
 * (including the customer-facing app, which must never see inactive plans).
 *
 * `updatedAt` is emitted for parity with the live-course / test-series / ebook plan
 * DTOs. The admin picker ages inactive plans by it ("active, plus inactive updated in
 * the last 7 days"), so an inactive row without it cannot be shown. ⚠ It is
 * `updated_at`, NOT a deactivated-at — a plan switched off months ago but renamed
 * yesterday looks recent. No table has a deactivated-at column; see the handoff.
 */
export const listPlansForTarget = async (courseId?: number, packageId?: number, status?: boolean) => {
  const plans = await repo.plansForTarget({ courseId, packageId, status });
  return plans.map((p) => ({ _id: String(p.id), name: p.name ?? null, duration: p.duration, price: p.price, materialPrice: p.materialPrice ?? 0, withMaterial: p.withMaterial, isDefault: p.isDefault, status: p.status, courseId: idStr(p.courseId), packageId: idStr(p.packageId), updatedAt: p.updated_at ?? null }));
};

// ── ebook subscriptions list ────────────────────────────────────────────────────
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

// ── reports ────────────────────────────────────────────────────────────────────
const dateWhere = (fromDate?: string, toDate?: string) => {
  if (!fromDate && !toDate) return {};
  const createdAt: any = {};
  if (fromDate) createdAt.gte = new Date(fromDate);
  if (toDate) createdAt.lte = new Date(toDate);
  return { createdAt };
};

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
