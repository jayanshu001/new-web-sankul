// Live courses: admin subscriptions (grant/update/move/deactivate/add days), the subscription report and its CSV/XLSX exports.
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import type { ReportSource } from "../../utils/reportStream";
import { computeEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import { andWhere, statusWhere, normalizeStatus, reportRow, blankStrToNull, decToNum, rowHasMaterial, trackingToNumber } from "../../utils/reportFilters";
import type { LiveCourseOrder, LiveCourseSubscription } from "@prisma/client";
// Value import: the type-only line above cannot supply the Decimal constructor.
import { Prisma as PrismaRuntime } from "@prisma/client";
// Shared course/material money split, so a live-course grant books it like a package sub.
import { computeMaterialSplit } from "../commerce-order/commerce-order.service";
import { fmtExportDate } from "../../utils/csvExport";
import { appendAdminRemark, movedRemarkText, planAddDays, planDateShift, planDeactivation, planDeactivationRevert, planQueuedStart, type DateShift } from "../../utils/subscriptionRemarkHistory";
import { LiveSubWithOrder, idStrOrNull, parseLiveId } from "./live-course.shared";

/**
 * Redeemed code + earner from the subscription's purchase-time snapshot columns
 * (`promocode` / `refferalcode`, written by modules/order-code-snapshot). The legacy
 * referral shape overloads `promoter` to mean the referring customer:
 *
 *   promocode    → code = $.promocode,             earner = $.promoter.full_name
 *   refferalcode → code = $.promoter.referralCode, earner = $.promoter.fullName
 *
 * Rows without a snapshot yield empty strings.
 */
const subCodeInfo = (r: {
  promocode?: unknown;
  refferalcode?: unknown;
}): {
  code: string;
  promoterName: string;
  promoterId: number | null;
  promocodeId: number | null;
  codeType: "promocode" | "referral" | null;
} => {
  const promo = r.promocode as any;
  if (promo && typeof promo === "object") {
    return {
      code: typeof promo.promocode === "string" ? promo.promocode : "",
      promoterName: (promo.promoter?.full_name ?? "").trim(),
      promoterId: typeof promo.promoterId === "number" ? promo.promoterId : null,
      promocodeId: typeof promo.id === "number" ? promo.id : null,
      codeType: "promocode",
    };
  }
  const ref = r.refferalcode as any;
  if (ref && typeof ref === "object") {
    return {
      code: (ref.promoter?.referralCode ?? "").trim(),
      promoterName: (ref.promoter?.fullName ?? "").trim(),
      // A referral has no promoterId: the earner is a customer, and reporting a promoter
      // would attribute customer referral rewards as promoter commission.
      promoterId: null,
      promocodeId: null,
      codeType: "referral",
    };
  }
  return { code: "", promoterName: "", promoterId: null, promocodeId: null, codeType: null };
};

/** Payment lives only on ws_live_course_order; an unlinked row has no payment. */
const payOf = (row: any, orders: Map<number, LiveCourseOrder>): LiveCourseOrder | null =>
  (row.orderId != null ? orders.get(row.orderId) ?? null : null);

// Order enum → wire vocabulary. 'cancel' (current) and 'failed' (older rows) both map
// to "failed" so the response is unchanged.
const payStatusOf = (pay: any): string | null =>
  pay?.status === "complete" ? "verified"
  : pay?.status === "pending" ? "pending"
  : pay?.status === "cancel" || pay?.status === "failed" ? "failed"
  : null;

const hydrateSubs = async (rows: LiveCourseSubscription[]) => {
  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x) => x > 0))])).map((c) => [c.id, c]));
  const courses = new Map((await repo.coursesByIds([...new Set(rows.map((r) => r.liveCourseId))])).map((c) => [c.id, c]));
  const plans = new Map((await repo.plansByIds([...new Set(rows.map((r) => r.planId).filter((x): x is number => x != null))])).map((p) => [p.id, p]));
  const orders = new Map((await repo.ordersByIds([...new Set(rows.map((r) => (r as any).orderId).filter((x): x is number => x != null))])).map((o) => [o.id, o]));
  return rows.map((r) => {
    const c = custs.get(r.customerId);
    const name = c ? splitFullName(c.fullName) : null;
    const course = courses.get(r.liveCourseId);
    const plan = r.planId != null ? plans.get(r.planId) : undefined;
    const pay = payOf(r, orders);
    return {
      _id: String(r.id),
      customerId: c && name ? { _id: String(c.id), firstName: name.firstName, lastName: name.lastName, phoneNumber: c.phoneNumber, emailAddress: c.emailAddress ?? null } : idStrOrNull(r.customerId),
      liveCourseId: course ? { _id: String(course.id), name: course.name, image: course.image ?? null } : idStrOrNull(r.liveCourseId),
      planId: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: plan.price } : idStrOrNull(r.planId),
      startAt: r.startAt ?? null, endAt: r.endAt ?? null, status: r.status,
      // `amount` = ws_live_course_order.discount_price (charged); `updatedAt` is the order's
      // paid-at.
      paidAmount: pay?.amount ?? 0, paymentStatus: payStatusOf(pay), paidAt: pay?.updatedAt ?? null,
      // Purchase-time snapshot objects, not bare ids (same contract as
      // ws_package_course_order). At most one is non-null.
      promocode: (pay?.promocode as unknown) ?? null,
      refferalcode: (pay?.refferalcode as unknown) ?? null,
      createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
    };
  });
};

// Reports contract shared by the 4 admin subscription reports
// (docs/REPORTS_SUBSCRIPTIONS_ADMIN.md): { summary, data, pagination }; summary respects
// filters but not pagination. `status` is normalized active|expired|inactive;
// paymentMethod is online|backend (online = razorpay_order_id present).

// Param contract shared by the list + its exports (all strings). `startFrom`/`endTo` are
// half-open and parsed with a bare `new Date()`, not parseDayBoundIst, so a bare
// YYYY-MM-DD reads as UTC midnight and drops the last 5.5h. Harmless while the screen
// exposes neither filter; fix before wiring them up.
export interface SubReportQuery {
  liveCourseId?: string; customerId?: string; status?: string; paymentMethod?: string;
  activationType?: string; dateFrom?: string; dateTo?: string; startFrom?: string; endTo?: string;
  search?: string; sortBy?: string; sortOrder?: string;
}

const coercePayMethod = (v?: string): "online" | "backend" | undefined =>
  v === "online" ? "online" : v === "backend" ? "backend" : undefined;

// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to → 23:59:59.999
// at +05:30) so a naive UTC parse doesn't drop the last 5.5h; full timestamps pass
// through, invalid → undefined. Same as the Subscription + Test Series reports.
const parseDayBoundIst = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  // "YYYY-MM-DDTHH:mm" (report date-time picker) is IST wall-clock too; the to-bound
  // covers the whole picked minute.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`)
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)
      ? new Date(`${s}:${end ? "59.999" : "00.000"}+05:30`)
      : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// Shared filter resolution for the list + its exports: the composed `where` (base
// filters AND normalized-status fragment) + sort, or a string for a bad id / a search
// that matched nothing.
const resolveSubFilter = async (
  q: SubReportQuery,
  now: Date
): Promise<
  | "bad_course"
  | "bad_customer"
  | "empty"
  | { listWhere: any; sortBy: string; sortDir: "asc" | "desc" }
> => {
  let liveCourseId: number | undefined, customerId: number | undefined;
  if (q.liveCourseId) { liveCourseId = parseLiveId(q.liveCourseId) ?? undefined; if (!liveCourseId) return "bad_course"; }
  if (q.customerId) { customerId = parseLiveId(q.customerId) ?? undefined; if (!customerId) return "bad_customer"; }

  let customerIdsIn: number[] | undefined;
  if (q.search) {
    // No "empty" short-circuit: order / payment / tracking ids can still match in-query.
    customerIdsIn = await repo.customerIdsByText(q.search);
  }

  const base = repo.buildSubBaseWhere({
    customerId, liveCourseId,
    // activationType has the same online|backend semantics; paymentMethod wins when both are sent.
    paymentMethod: coercePayMethod(q.paymentMethod) ?? coercePayMethod(q.activationType),
    fromDate: parseDayBoundIst(q.dateFrom, false),
    toDate: parseDayBoundIst(q.dateTo, true),
    startFrom: q.startFrom ? new Date(q.startFrom) : undefined,
    endTo: q.endTo ? new Date(q.endTo) : undefined,
    customerIdsIn, search: q.search,
  });
  const listWhere = andWhere(base, statusWhere(q.status, now));
  const sortBy = q.sortBy ?? "createdAt";
  const sortDir = (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc";
  return { listWhere, sortBy, sortDir };
};

// Report columns shared by list + export so the screen and the download never disagree.
// Educator / shipping / activated-by take one batched lookup each, as in admin-subscription.

type ReportAddress = { id: number; userId: number | null; address: string | null; address_2: string | null; city: string | null; pincode: number | string | null; alternate_phone: any };
type SubReportExtras = {
  educators: Map<number, { id: number; name: string | null }>;
  /** Keyed `<addressId>:<customerId>` (see resolveReportAddresses). */
  shippings: Map<string, ReportAddress>;
  admins: Map<string, { firstName: string | null; lastName: string | null }>;
};

/**
 * Delivery address behind each subscription's `shipping` id. By contract that is a
 * ws_customer_shipping.id, but the live-course checkout stores a raw address-book id
 * (live-course-payment.controller), so try shipping first, then ws_customer_address.
 * Every hit is verified against the subscription's own customer: nothing enforces the
 * two id spaces stay disjoint, and a collision must never print another customer's
 * address. A failing row is dropped (renders "—") rather than guessed.
 */
const resolveReportAddresses = async (
  wanted: { shippingId: number; customerId: number }[]
): Promise<Map<string, ReportAddress>> => {
  const out = new Map<string, ReportAddress>();
  if (!wanted.length) return out;
  const ids = [...new Set(wanted.map((w) => w.shippingId))];
  const [ships, addrs] = await Promise.all([repo.shippingsByIds(ids), repo.addressesByIds(ids)]);
  const shipById = new Map(ships.map((r) => [r.id, r as ReportAddress]));
  const addrById = new Map(addrs.map((r) => [r.id, r as ReportAddress]));
  for (const w of wanted) {
    const hit = shipById.get(w.shippingId) ?? addrById.get(w.shippingId);
    if (!hit) continue;
    if (hit.userId != null && hit.userId !== w.customerId) continue; // never cross customers
    out.set(`${w.shippingId}:${w.customerId}`, hit);
  }
  return out;
};

/** One batched lookup per relation for a page/batch of subscription rows. */
const hydrateSubReportExtras = async (
  rows: LiveSubWithOrder[],
  courses: Map<number, { id: number; educatorId?: number | null }>
): Promise<SubReportExtras> => {
  const educatorIds = [...new Set(rows.map((r) => courses.get(r.liveCourseId)?.educatorId).filter((x): x is number => x != null && x > 0))];
  // The subscription's own address wins; fall back to the order's (both are
  // ws_customer_shipping.id by contract).
  const wantedAddresses = rows
    .map((r) => ({ shippingId: (r.shipping ?? r.order?.shipping) as number | null, customerId: r.customerId }))
    .filter((w): w is { shippingId: number; customerId: number } => w.shippingId != null && w.shippingId > 0);
  const adminIds = [...new Set(rows.map((r) => r.created_by).filter((x): x is number => x != null && x > 0))];
  const [educators, shippings, admins] = await Promise.all([
    repo.educatorsByIds(educatorIds),
    resolveReportAddresses(wantedAddresses),
    repo.adminUsersByIds(adminIds),
  ]);
  return {
    educators: new Map(educators.map((e) => [e.id, e])),
    shippings,
    // ws_users PK is BigInt; key by string so the lookup can't miss on 1n !== 1.
    admins: new Map(admins.map((a) => [String(a.id), a])),
  };
};

/** Key names + types mirror admin-subscription.service. */
const subReportColumns = (r: LiveSubWithOrder, pay: LiveCourseOrder | null | undefined, x: SubReportExtras, course?: { educatorId?: number | null }) => {
  const educatorId = course?.educatorId ?? null;
  const educator = educatorId != null ? x.educators.get(educatorId) ?? null : null;
  const shipId = r.shipping ?? pay?.shipping ?? null;
  const ship = shipId != null ? x.shippings.get(`${shipId}:${r.customerId}`) ?? null : null;
  const admin = r.created_by != null ? x.admins.get(String(r.created_by)) ?? null : null;
  const adminName = admin ? `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() : "";
  return {
    // Courier tracking (allocated at verify for material subs); null until assigned.
    trackingId: trackingToNumber(r.tracking),
    educatorName: educator?.name ?? null,
    educatorId: educator?.id ?? null,
    // The split computeMaterialSplit books at verify.
    courseAmount: decToNum(r.courseAmount),
    materialAmount: decToNum(r.materialAmount),
    wsCoin: pay?.wsCoin ?? null,
    // The gateway (razorpay|bank|cash|free|…), lowercased; not online/backend, which is
    // `paymentMethod` and has its own Activation Type column.
    orderMethod: pay?.paymentMethod ? String(pay.paymentMethod).toLowerCase() : null,
    materialType: rowHasMaterial(r) ? "With Material" : "Without Material",
    // No source for "Activation Type"; same null the Subscription report emits.
    activationType: null as string | null,
    razorpayOrderId: pay ? blankStrToNull(pay.razorpayOrderId) : null,
    razorpayPaymentId: pay ? blankStrToNull(pay.razorpayPaymentId) : null,
    bankTransactionId: pay ? blankStrToNull(pay.bankTransactionId) : null,
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
};

export const listSubscriptions = async (q: SubReportQuery & {
  page: number; limit: number;
}): Promise<
  | "bad_course"
  | "bad_customer"
  | { summary: { totalCount: number; totalRevenue: number; activeCount: number; expiredCount: number }; data: any[]; pagination: { total: number; page: number; limit: number; totalPages: number } }
> => {
  const now = new Date();
  const emptyPage = { summary: { totalCount: 0, totalRevenue: 0, activeCount: 0, expiredCount: 0 }, data: [], pagination: { total: 0, page: q.page, limit: q.limit, totalPages: 0 } };

  const filter = await resolveSubFilter(q, now);
  if (filter === "bad_course" || filter === "bad_customer") return filter;
  if (filter === "empty") return emptyPage;
  const { listWhere, sortBy, sortDir } = filter;

  const [rows, agg, activeCount, expiredCount] = await Promise.all([
    repo.listSubsByWhere(listWhere, sortBy, sortDir, (q.page - 1) * q.limit, q.limit),
    repo.aggSubs(listWhere),
    repo.countSubs(andWhere(listWhere, statusWhere("active", now))),
    repo.countSubs(andWhere(listWhere, statusWhere("expired", now))),
  ]);
  const total = agg._count._all;

  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x) => x > 0))])).map((c) => [c.id, c]));
  const courses = new Map((await repo.coursesByIds([...new Set(rows.map((r) => r.liveCourseId))])).map((c) => [c.id, c]));
  const plans = new Map((await repo.plansByIds([...new Set(rows.map((r) => r.planId).filter((x): x is number => x != null))])).map((p) => [p.id, p]));
  // Payment is not re-fetched: `listSubsByWhere` already includes the order (`r.order`).
  const extra = await hydrateSubReportExtras(rows, courses);

  const data = rows.map((r) => {
    const course = courses.get(r.liveCourseId);
    const plan = r.planId != null ? plans.get(r.planId) : undefined;
    const pay = r.order;
    const base = reportRow({
      cust: r.customerId ? custs.get(r.customerId) : undefined,
      product: course ? { _id: String(course.id), type: "liveCourse" as const, name: course.name, image: course.image ?? null } : null,
      plan: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: Number(plan.price) } : null,
      amount: pay?.amount != null ? Number(pay.amount) : 0,
      paymentMethod: pay?.razorpayOrderId ? "online" : "backend",
      status: normalizeStatus({ status: r.status, startAt: r.startAt, endAt: r.endAt }, now),
      startAt: r.startAt ?? null, endAt: r.endAt ?? null, createdAt: r.createdAt ?? null,
    });
    // Code attribution from the row's own snapshot columns (no extra query). Keys and types
    // match the Subscription report (admin-subscription.service): `promocode` is the code
    // string; the full frozen objects ride under `promocodeSnapshot` / `refferalcodeSnapshot`.
    const code = subCodeInfo(pay ?? {});
    return {
      id: r.id,
      ...base,
      promocode: code.code || null,
      promocodeId: code.promocodeId,
      promoterName: code.promoterName || null,
      promoterId: code.promoterId,
      codeType: code.codeType,
      promocodeSnapshot: (pay?.promocode as unknown) ?? null,
      refferalcodeSnapshot: (pay?.refferalcode as unknown) ?? null,
      // Report columns, key-for-key with the Subscription report: both feed one frontend
      // normalizer and table, so a renamed or retyped key shows up as a silently blank
      // column. Unknown is always null, never "" or 0 (the table prints a literal 0).
      ...subReportColumns(r, pay, extra, course),
    };
  });

  return {
    summary: { totalCount: total, totalRevenue: Number(agg._sum.paidAmount ?? 0), activeCount, expiredCount },
    data,
    pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
  };
};

// Exports cover the entire filtered set with no row cap, keyset-paged (no deep OFFSET)
// and mapped per batch so memory stays bounded.
const LIVE_SUB_EXPORT_BATCH = 5000;

// One flat export row per subscription, built from the same `subReportColumns` helper
// as the screen so the download can never disagree with the table. Most values ride on
// the row and its included order; educator/shipping/activated-by cost one batched
// lookup per batch; promocode + promoter come from snapshot columns.
const buildSubExportRow = (
  r: LiveSubWithOrder,
  cust: { id: number; fullName: string | null; phoneNumber: string | null; emailAddress: string | null } | undefined,
  course: { id: number; name: string; educatorId?: number | null } | undefined,
  extra: SubReportExtras,
  now: Date
) => {
  // Payment (amount, gateway ids, code snapshots) comes from the order.
  const pay = r.order;
  const method = pay?.razorpayOrderId ? "online" : "backend";
  const code = subCodeInfo(pay ?? {});
  return {
    _id: String(r.id),
    promocode: code.code,
    promoterName: code.promoterName,
    customerName: (cust?.fullName ?? "").trim(),
    phone: cust?.phoneNumber ?? "",
    email: cust?.emailAddress ?? "",
    courseName: course?.name ?? "",
    startAt: r.startAt ?? null,
    endAt: r.endAt ?? null,
    amount: pay?.amount != null ? Number(pay.amount) : 0,
    paymentMethod: method,
    activationType: method,
    razorpayOrderId: pay?.razorpayOrderId ?? "",
    razorpayPaymentId: pay?.razorpayPaymentId ?? "",
    status: normalizeStatus({ status: r.status, startAt: r.startAt, endAt: r.endAt }, now),
    // The 13 report columns, from the one helper the list DTO uses. A spreadsheet
    // cell wants "" where the JSON wants null — the column getters below do that
    // conversion, so the values stay identical to the screen's.
    cols: subReportColumns(r, pay, extra, course),
  };
};

// Maps one keyset batch to export rows, resolving customer/course maps for that batch only.
const mapSubExportBatch = async (rows: LiveSubWithOrder[], now: Date) => {
  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x) => x > 0))])).map((c) => [c.id, c]));
  const courses = new Map((await repo.coursesByIds([...new Set(rows.map((r) => r.liveCourseId))])).map((c) => [c.id, c]));
  // Educator / shipping / activated-by, batched per page.
  const extra = await hydrateSubReportExtras(rows, courses);
  return rows.map((r) => buildSubExportRow(r, r.customerId ? custs.get(r.customerId) : undefined, courses.get(r.liveCourseId), extra, now));
};

// Walks the entire filtered set in keyset batches. `filter` is the resolved where+sort
// from resolveSubFilter (the caller handles bad-id/empty first).
async function* iterateSubExportRows(filter: { listWhere: any }, now: Date) {
  let beforeId: number | undefined;
  for (;;) {
    const rows = await repo.listSubsPageKeyset(filter.listWhere, beforeId, LIVE_SUB_EXPORT_BATCH);
    if (!rows.length) break;
    yield await mapSubExportBatch(rows, now);
    if (rows.length < LIVE_SUB_EXPORT_BATCH) break;
    beforeId = rows[rows.length - 1].id;
  }
}

// Column order mirrors the detailed subscription report table: the client reconciles
// the two files column for column, so the 27 headers and their order are fixed.
const cell = (v: string | number | null | undefined): string | number => (v == null ? "" : v);
// "Package Name" stays blank by design: a live course is not a package, but one table
// is shared across four reports.
const LIVE_SUB_EXPORT_COLUMNS: { header: string; get: (i: ReturnType<typeof buildSubExportRow>) => string | number }[] = [
  { header: "Subscription ID", get: (i) => i._id },
  { header: "Customer Name", get: (i) => i.customerName },
  { header: "Phone", get: (i) => i.phone },
  { header: "Email", get: (i) => i.email },
  { header: "Course Name", get: (i) => i.courseName },
  { header: "Package Name", get: () => "" },
  { header: "Educator Name", get: (i) => cell(i.cols.educatorName) },
  { header: "Promocode", get: (i) => i.promocode },
  { header: "Promoter Name", get: (i) => i.promoterName },
  { header: "Start Date", get: (i) => fmtExportDate(i.startAt) },
  { header: "End Date", get: (i) => fmtExportDate(i.endAt) },
  { header: "Amount", get: (i) => i.amount },
  { header: "Course Amount", get: (i) => cell(i.cols.courseAmount) },
  { header: "Material Amount", get: (i) => cell(i.cols.materialAmount) },
  { header: "Ws Coin", get: (i) => cell(i.cols.wsCoin) },
  { header: "Material Type", get: (i) => cell(i.cols.materialType) },
  // Activation channel (online|backend), distinct from Order Method below.
  { header: "Activation Type", get: (i) => i.activationType },
  // The gateway off the order (not a repeat of `paymentMethod`).
  { header: "Order Method", get: (i) => cell(i.cols.orderMethod) },
  { header: "Order Id", get: (i) => i.razorpayOrderId },
  { header: "Payment Id", get: (i) => i.razorpayPaymentId },
  { header: "Bank Transaction Id", get: (i) => cell(i.cols.bankTransactionId) },
  { header: "Address", get: (i) => cell(i.cols.shipping?.address) },
  { header: "City", get: (i) => cell(i.cols.shipping?.city) },
  { header: "Pincode", get: (i) => cell(i.cols.shipping?.pincode) },
  { header: "Remarks", get: (i) => cell(i.cols.remarks) },
  { header: "Activated By", get: (i) => cell(i.cols.activatedBy) },
  { header: "Status", get: (i) => i.status },
];

export const buildSubscriptionsCsv = async (q: SubReportQuery): Promise<"bad_course" | "bad_customer" | string> => {
  const now = new Date();
  const filter = await resolveSubFilter(q, now);
  if (filter === "bad_course" || filter === "bad_customer") return filter;
  const resolved = filter === "empty" ? null : filter;
  async function* rowBatches() {
    if (resolved) {
      for await (const batch of iterateSubExportRows(resolved, now)) {
        yield batch.map((r) => LIVE_SUB_EXPORT_COLUMNS.map((c) => c.get(r)));
      }
    }
  }
  return buildCsvFromRowBatches(LIVE_SUB_EXPORT_COLUMNS.map((c) => c.header), rowBatches());
};

export const buildSubscriptionsXlsx = async (q: SubReportQuery): Promise<"bad_course" | "bad_customer" | Buffer> => {
  const now = new Date();
  const filter = await resolveSubFilter(q, now);
  if (filter === "bad_course" || filter === "bad_customer") return filter;
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  const finished = new Promise<void>((resolve, reject) => {
    pass.once("end", resolve);
    pass.once("error", reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet("Live Course Subscriptions");
  ws.columns = LIVE_SUB_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 22 }));
  if (filter !== "empty") {
    for await (const batch of iterateSubExportRows(filter, now)) {
      for (const r of batch) ws.addRow(LIVE_SUB_EXPORT_COLUMNS.map((c) => c.get(r))).commit();
    }
  }
  ws.commit();
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
};

// Streamed export source (async job path); same rows/columns as the sync builders.
// Throws on a bad id filter (the worker marks the job failed with this message).
export async function liveSubExportSource(q: SubReportQuery): Promise<ReportSource> {
  const now = new Date();
  const filter = await resolveSubFilter(q, now);
  if (filter === "bad_course") throw new Error("Invalid liveCourseId filter.");
  if (filter === "bad_customer") throw new Error("Invalid customerId filter.");
  return {
    worksheetName: "Live Course Subscriptions",
    headers: LIVE_SUB_EXPORT_COLUMNS.map((c) => c.header),
    rowBatches: (async function* () {
      if (filter !== "empty") {
        for await (const batch of iterateSubExportRows(filter, now)) {
          yield batch.map((r) => LIVE_SUB_EXPORT_COLUMNS.map((c) => c.get(r)));
        }
      }
    })(),
  };
}

export const getSubscription = async (id: number): Promise<"not_found" | any> => {
  const row = await repo.findSubscriptionById(id);
  if (!row) return "not_found";
  return (await hydrateSubs([row]))[0];
};

// Admin grant/extend: always a new order + subscription row; extend starts at the active endAt.
export const grantSubscription = async (liveCourseId: number, v: { customerId: string; planId?: string; durationDays?: number; durationMonths?: number; startAt?: string; endAt?: string; amount?: number; withMaterial?: boolean; customerShippingId?: string | null; remarks?: string | null; paymentMethod?: string; bankTransactionId?: string | null; razorpayOrderId?: string | null; razorpayPaymentId?: string | null; extend?: boolean; actingAdminId?: number | null }): Promise<{ ok: false; code: string; msg: string } | { ok: true; created: boolean; data: any }> => {
  if (!(await repo.exists(liveCourseId))) return { ok: false, code: "course", msg: "Live course not found." };
  const customerId = parseLiveId(v.customerId);
  // planId is optional: with a plan the window is derived (and the plan validated against
  // this course); without one, amount + duration/endAt drive the grant.
  const planId = v.planId ? parseLiveId(v.planId) : null;
  if (!customerId || !(await repo.customerExists(customerId))) return { ok: false, code: "customer", msg: "Customer not found." };
  const plan = planId ? await repo.findPlanById(planId) : null;
  if (v.planId && !plan) return { ok: false, code: "plan", msg: "Plan not found." };
  if (plan && plan.liveCourseId !== liveCourseId) return { ok: false, code: "mismatch", msg: "Plan does not belong to this live course." };

  const now = new Date();
  let startAt = now;
  if (v.startAt) { const dt = new Date(v.startAt); if (isNaN(dt.getTime())) return { ok: false, code: "startAt", msg: "startAt must be a valid date." }; startAt = dt; }
  // plan.duration is in days (computeEndAt asDays).
  let endAt: Date;
  if (v.endAt) { const dt = new Date(v.endAt); if (isNaN(dt.getTime())) return { ok: false, code: "endAt", msg: "endAt must be a valid date." }; endAt = dt; }
  else if (v.durationDays != null) endAt = computeEndAt({ startAt, durationMonths: v.durationDays, asDays: true });
  else if (v.durationMonths != null) endAt = computeEndAt({ startAt, durationMonths: v.durationMonths });
  else if (plan) endAt = computeEndAt({ startAt, durationMonths: plan.duration, asDays: true });
  else return { ok: false, code: "duration", msg: "durationDays is required (or supply planId)." };
  if (endAt.getTime() <= startAt.getTime()) return { ok: false, code: "window", msg: "endAt must be after startAt." };

  // One order = one subscription row. An extension only reads the current entitlement to
  // decide where the new window starts, then writes its own order and subscription row.
  const existing = v.extend === true ? await repo.findActiveSubscription(customerId, liveCourseId, now) : null;
  const grantStartAt =
    existing?.endAt && existing.endAt.getTime() > now.getTime() ? existing.endAt : startAt;
  // Recompute the window from the continuation start; an explicit admin endAt still wins.
  const grantEndAt = v.endAt
    ? endAt
    : v.durationDays != null
      ? computeEndAt({ startAt: grantStartAt, durationMonths: v.durationDays, asDays: true })
      : v.durationMonths != null
        ? computeEndAt({ startAt: grantStartAt, durationMonths: v.durationMonths })
        : plan
          ? computeEndAt({ startAt: grantStartAt, durationMonths: plan.duration, asDays: true })
          : endAt;
  if (grantEndAt.getTime() <= grantStartAt.getTime()) return { ok: false, code: "window", msg: "endAt must be after startAt." };

  const shippingId = v.customerShippingId != null ? parseLiveId(v.customerShippingId) : null;
  // Entitled material kit from the live course (twin of the package path's
  // findCoursePcMaterialId / findPackagePcMaterialId).
  const liveCourseForGrant = await repo.liveCourseMaterialKit(liveCourseId);

  // The order carries only this grant's payment, never a running total. It has only the
  // ws_package_course_order columns: with_material, remarks, created_by and updated_by
  // live on the subscription below; `updated_at` is the paid-at.
  const order = await repo.createOrder({
    customerId,
    liveCourseId,
    planId,
    orderType: "purchase",
    amount: v.amount ?? 0,
    // A manual grant has no list price of its own and redeems no code: price = amount,
    // discount 0.
    originalPrice: v.amount ?? 0,
    codeDiscount: 0,
    paymentMethod: v.paymentMethod ?? "cash",
    razorpayOrderId: v.razorpayOrderId ?? null,
    razorpayPaymentId: v.razorpayPaymentId ?? null,
    bankTransactionId: v.bankTransactionId ?? null,
    status: "complete",
    shipping: shippingId,
    createdAt: now,
    updatedAt: now,
  });

  // No promocode on a manual grant, so no promoter to attribute. `payment_type` is
  // "backend" unless the admin recorded a gateway id (same rule as the report's
  // activationType).
  const grantAmount = v.amount ?? 0;
  const grantMaterial = computeMaterialSplit(grantAmount, plan);
  const sub = await repo.createSubscription({
    orderId: order.id,
    customerId, liveCourseId, planId, startAt: grantStartAt, endAt: grantEndAt, status: true,
    withMaterial: !!v.withMaterial,
    shipping: shippingId,
    pcMaterialId: liveCourseForGrant?.pcMaterialId ?? null,
    amount: grantAmount,
    courseAmount: grantMaterial.courseAmount,
    materialAmount: grantMaterial.materialAmount,
    paidAmount: new PrismaRuntime.Decimal(grantAmount),
    payment_type: v.razorpayOrderId ? "online" : "backend",
    remarks: v.remarks ?? null,
    // Manual grant → both audit columns = the acting admin.
    created_by: v.actingAdminId ?? null,
    updated_by: v.actingAdminId ?? null,
    createdAt: now, updatedAt: now,
  });
  // `created` says whether this started a new entitlement or continued one (the
  // controller's "granted" vs "extended" message); both write a new row.
  return { ok: true, created: !existing, data: (await hydrateSubs([sub]))[0] };
};

export const updateSubscription = async (id: number, v: { status?: boolean; paymentStatus?: string; startAt?: string; endAt?: string; actingAdminId?: number | null }): Promise<"not_found" | "bad_start" | "bad_end" | any> => {
  const current = await repo.findSubscriptionById(id);
  if (!current) return "not_found";
  const data: any = { updatedAt: new Date() };
  // Admin edit → stamp updated_by (created_by untouched).
  if (v.actingAdminId != null) data.updated_by = v.actingAdminId;
  if (v.status !== undefined) data.status = v.status;
  if (v.startAt !== undefined) { const dt = new Date(v.startAt); if (isNaN(dt.getTime())) return "bad_start"; data.startAt = dt; }
  if (v.endAt !== undefined) { const dt = new Date(v.endAt); if (isNaN(dt.getTime())) return "bad_end"; data.endAt = dt; }

  if (v.paymentStatus !== undefined) {
    // Entitlement reads ignore `payment_status`, so writing it alone would revoke nothing.
    // To keep "failed" revoking: (1) the order's status is corrected so reports/receipts
    // agree, and (2) `status` follows it; anything but "verified" deactivates the row. An
    // explicit `status` in the same request still wins.
    data.paymentStatus = v.paymentStatus;
    if (v.status === undefined) data.status = v.paymentStatus === "verified";
    if ((current as any).orderId != null) {
      // The order has no audit columns; `updated_by` is stamped on the subscription above.
      await repo.updateOrder((current as any).orderId, {
        // "failed" on the wire is 'cancel' in the column.
        status: v.paymentStatus === "verified" ? "complete" : v.paymentStatus === "pending" ? "pending" : "cancel",
        updatedAt: new Date(),
      });
    }
  }

  const updated = await repo.updateSubscription(id, data);
  return (await hydrateSubs([updated]))[0];
};

/**
 * Read before an admin revoke (status flip / date change / delete) so the caller can
 * flush that customer's route cache; after delete the row is gone.
 */
export const getSubscriptionCustomerId = async (id: number): Promise<number | null> =>
  (await repo.findSubscriptionCustomerId(id))?.customerId ?? null;

export const deleteSubscription = async (id: number): Promise<boolean> => {
  if (!(await repo.findSubscriptionById(id))) return false;
  await repo.deleteSubscription(id);
  return true;
};

type HistoryInput = { remark?: string | null; actingAdminId?: number | null };

const liveCourseLabel = async (liveCourseId: number): Promise<string> => {
  const [course] = await repo.coursesByIds([liveCourseId]);
  return `Live course "${course?.name ?? ""}" (#${liveCourseId})`;
};

const historyPatch = async (remarks: string | null, what: string, input: HistoryInput, now: Date) => ({
  remarks: await appendAdminRemark(
    remarks,
    { what, remark: input.remark, actingAdminId: input.actingAdminId, now },
    repo.adminUsersByIds
  ),
  updatedAt: now,
  ...(input.actingAdminId != null ? { updated_by: input.actingAdminId } : {}),
});

const hydrateOne = async (row: Parameters<typeof hydrateSubs>[0][number]) => (await hydrateSubs([row]))[0];

export type ChangeLiveCourseResult =
  | { ok: false; reason: "not_found" | "target_not_found" | "same_target" }
  | { ok: false; reason: "needs_confirmation"; dateShift: DateShift }
  | { ok: true; customerId: number; data: any };

export const changeSubscriptionLiveCourse = async (
  id: number,
  input: HistoryInput & { liveCourseId: number; confirmDates?: boolean }
): Promise<ChangeLiveCourseResult> => {
  const existing = await repo.findSubscriptionById(id);
  if (!existing) return { ok: false, reason: "not_found" };
  if (!(await repo.exists(input.liveCourseId))) return { ok: false, reason: "target_not_found" };
  if (existing.liveCourseId === input.liveCourseId) return { ok: false, reason: "same_target" };

  const [fromLabel, toLabel] = await Promise.all([
    liveCourseLabel(existing.liveCourseId),
    liveCourseLabel(input.liveCourseId),
  ]);
  const changed = `Live course changed: ${fromLabel} -> ${toLabel}`;

  // Overlaps an active subscription to the target live course → hold for confirmation,
  // then queue this row's remaining time after it.
  const now = new Date();
  const dateShift = planDateShift(existing, await repo.activeSubsForTarget(existing.customerId, input.liveCourseId, now), now);
  if (dateShift && !input.confirmDates) return { ok: false, reason: "needs_confirmation", dateShift };
  const what = dateShift ? `${changed}. ${dateShift.what}` : changed;

  const updated = await repo.updateSubscription(id, {
    liveCourseId: input.liveCourseId,
    ...(dateShift ? { startAt: dateShift.startAt, endAt: dateShift.endAt } : {}),
    ...(await historyPatch(existing.remarks, what, input, now)),
  });

  return { ok: true, customerId: existing.customerId, data: await hydrateOne(updated) };
};

export type MoveLiveSubscriptionResult =
  | { ok: false; reason: "not_found" | "customer_not_found" | "same_customer" }
  | { ok: false; reason: "needs_confirmation"; dateShift: DateShift }
  | { ok: true; fromCustomerId: number; toCustomerId: number; data: any };

export const moveLiveSubscription = async (
  id: number,
  input: HistoryInput & { customerId: number; confirmDates?: boolean }
): Promise<MoveLiveSubscriptionResult> => {
  const existing = await repo.findSubscriptionById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const target = await repo.findLiveCustomer(input.customerId);
  if (!target) return { ok: false, reason: "customer_not_found" };
  if (existing.customerId === target.id) return { ok: false, reason: "same_customer" };

  const [source] = await repo.customersByIds([existing.customerId]);
  const moved = movedRemarkText(
    { id: existing.customerId, phone: source?.phoneNumber },
    { id: target.id, phone: target.phoneNumber }
  );

  const now = new Date();
  const targetActives = await repo.activeSubsForTarget(target.id, existing.liveCourseId, now);
  const dateShift = planDateShift(existing, targetActives, now);
  if (dateShift && !input.confirmDates) return { ok: false, reason: "needs_confirmation", dateShift };
  const newDates = dateShift ?? planQueuedStart(existing, targetActives, now);
  const orderId = existing.orderId && (await repo.orderOwnedOnlyBy(existing.orderId, id)) ? existing.orderId : null;
  const what = [moved, orderId && `Order #${orderId} moved with it`, newDates?.what].filter(Boolean).join(". ");

  const subUpdate = repo.updateSubscription(id, {
    customerId: target.id,
    ...(newDates ? { startAt: newDates.startAt, endAt: newDates.endAt } : {}),
    ...(await historyPatch(existing.remarks, what, input, now)),
  });
  const [updated] = orderId ? await repo.transaction([subUpdate, repo.setOrderCustomer(orderId, target.id)]) : [await subUpdate];

  return { ok: true, fromCustomerId: existing.customerId, toCustomerId: target.id, data: await hydrateOne(updated) };
};

export type DeactivateLiveSubscriptionResult =
  | { ok: false; reason: "not_found" | "already_deactivated" }
  | { ok: true; customerId: number; data: any };

export const deactivateLiveSubscription = async (
  id: number,
  input: HistoryInput
): Promise<DeactivateLiveSubscriptionResult> => {
  const existing = await repo.findSubscriptionById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const now = new Date();
  const deactivation = planDeactivation(existing, now);
  if (!deactivation) return { ok: false, reason: "already_deactivated" };

  const updated = await repo.updateSubscription(id, {
    endAt: deactivation.endAt,
    status: deactivation.status,
    ...(await historyPatch(existing.remarks, deactivation.what, input, now)),
  });

  return { ok: true, customerId: existing.customerId, data: await hydrateOne(updated) };
};

export type RevertLiveDeactivationResult =
  | { ok: false; reason: "not_found" | "no_record" | "not_deactivated" }
  | { ok: true; customerId: number; data: any };

export const revertLiveSubscriptionDeactivation = async (
  id: number,
  input: HistoryInput
): Promise<RevertLiveDeactivationResult> => {
  const existing = await repo.findSubscriptionById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const revert = planDeactivationRevert(existing);
  if (!revert.ok) return revert;

  const now = new Date();
  const updated = await repo.updateSubscription(id, {
    endAt: revert.endAt,
    status: revert.status,
    ...(await historyPatch(existing.remarks, revert.what, input, now)),
  });

  return { ok: true, customerId: existing.customerId, data: await hydrateOne(updated) };
};

export type AddLiveSubscriptionDaysResult =
  | { ok: false; reason: "not_found" }
  | { ok: true; customerId: number; data: any };

export const addLiveSubscriptionDays = async (
  id: number,
  input: HistoryInput & { days: number }
): Promise<AddLiveSubscriptionDaysResult> => {
  const existing = await repo.findSubscriptionById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const now = new Date();
  const addition = planAddDays(existing, input.days, now);

  const updated = await repo.updateSubscription(id, {
    endAt: addition.endAt,
    ...(await historyPatch(existing.remarks, addition.what, input, now)),
  });

  return { ok: true, customerId: existing.customerId, data: await hydrateOne(updated) };
};
