import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { computeEndAt } from "../../utils/planDuration";
import { adminSubscriptionRepository as repo } from "./admin-subscription.repository";
import { andWhere, statusWhere, normalizeStatus, reportRow } from "../../utils/reportFilters";
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

const blankStrToNull = (v: string | null | undefined): string | null => (v ? v : null);
const decToNum = (v: any): number | null => (v != null ? Number(v) : null);

// Single source of truth for "with material" on a subscription row. Two signals
// exist and must never disagree: legacy Mongo-migrated rows carry a `pc_material_id`
// FK, while SQL-created admin grants carry only a `material_amount` (the create path
// deliberately writes material_amount and never pc_material_id — see
// createCourseSubscription). Either signal means the buyer took the physical
// material, so the "With Material" label can never contradict a nonzero
// materialAmount. Used by the report label, the single-detail flag, AND the
// hasMaterial report filter (repository) so all three agree.
const rowHasMaterial = (r: { pcMaterialId?: number | null; materialAmount?: any }): boolean =>
  (r.pcMaterialId != null && r.pcMaterialId > 0) || Number(r.materialAmount ?? 0) > 0;
// bigint `tracking` (courier AWB, ~1.19e11) → number, matching the Subscriptions
// management list (commerce-subscription transformer). Guard the >2^53 case → null.
const trackingToNumber = (v: bigint | null | undefined): number | null =>
  v == null ? null : v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
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

export const listCourseSubscriptions = async (q: CourseSubReportQuery & { page: number; limit: number }) => {
  const now = new Date();
  const emptyPage = { summary: { totalCount: 0, totalRevenue: 0, activeCount: 0, expiredCount: 0 }, data: [], pagination: { total: 0, page: q.page, limit: q.limit, totalPages: 0 } };

  const resolved = await resolveCourseSubWhere(q, now);
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
  const resolved = await resolveCourseSubWhere(q, now);
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
  const esc = (v: string | number) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [REPORT_EXPORT_COLUMNS.map((c) => esc(c.header)).join(",")];
  for await (const batch of iterateCourseSubExportRows(q, now)) {
    for (const r of batch) lines.push(REPORT_EXPORT_COLUMNS.map((c) => esc(c.get(r))).join(","));
  }
  return lines.join("\n");
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

export const getCourseSubscriptionById = async (id: number): Promise<"not_found" | any> => {
  const r = await repo.findCourseSubById(id);
  if (!r) return "not_found";
  const [cust] = r.customerId ? await repo.customersByIds([r.customerId]) : [undefined];
  const [course] = r.courseId ? await repo.coursesByIds([r.courseId]) : [undefined];
  const [plan] = r.planId ? await repo.plansByIds([r.planId]) : [undefined];
  return {
    _id: String(r.id),
    customerId: customerRef(cust),
    courseId: course ? { _id: String(course.id), name: course.name, image: course.image ?? null } : idStr(r.courseId),
    packageId: idStr(r.packageId),
    planId: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: plan.price } : idStr(r.planId),
    paidAmount: r.amount != null ? Number(r.amount) : 0,
    startAt: r.startAt ?? null, endAt: r.endAt ?? null,
    status: r.status, paymentMethod: r.payment_type ?? null, remark: r.remarks ?? null,
    withMaterial: rowHasMaterial(r),
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  };
};

// ── course/package subscription update / delete (admin edit) ─────────────────
// Only columns that exist on ws_package_course_subscription are patched;
// Mongo-only fields (paymentStatus/paymentMethod) have no column. Returns the
// same DTO shape as getCourseSubscriptionById.
export const updateCourseSubscription = async (
  id: number,
  patch: {
    startAt?: Date; endAt?: Date; status?: boolean;
    shippingId?: number | null; trackingId?: bigint | null; remark?: string;
  }
): Promise<"not_found" | any> => {
  if (!(await repo.findCourseSubById(id))) return "not_found";
  await repo.patchSub(id, {
    startAt: patch.startAt,
    endAt: patch.endAt,
    status: patch.status,
    shippingId: patch.shippingId,
    trackingId: patch.trackingId,
    remarks: patch.remark,
    now: new Date(),
  });
  return getCourseSubscriptionById(id);
};

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
  planId: number;
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
}

export type CreateCourseSubResult =
  | { ok: false; reason: "plan_not_found" | "course_mismatch" | "package_mismatch" | "shipping_required" }
  | { ok: true; extended: boolean; data: any };

export const createCourseSubscription = async (input: CreateCourseSubInput): Promise<CreateCourseSubResult> => {
  const plan = await repo.findPlanById(input.planId);
  if (!plan) return { ok: false, reason: "plan_not_found" };
  if (input.courseId && Number(plan.courseId ?? 0) !== input.courseId) return { ok: false, reason: "course_mismatch" };
  if (input.packageId && Number(plan.packageId ?? 0) !== input.packageId) return { ok: false, reason: "package_mismatch" };
  if (input.withMaterial && !input.customerShippingId) return { ok: false, reason: "shipping_required" };

  const resolvedCourseId = input.courseId || plan.courseId || null;
  const resolvedPackageId = input.packageId || plan.packageId || null;
  const computedAmount =
    input.amount != null ? input.amount : (plan.price || 0) + (input.withMaterial ? (plan.materialPrice || 0) : 0);
  const now = new Date();

  // The order row carrying the granular payment method + reference ids + amount.
  // Written for both fresh grants and extends (an extend is still a paid txn); the
  // Subscription Report reads these ids back via the subscription's order_id.
  const makeOrder = () =>
    repo.createPaymentOrder({
      customerId: input.customerId,
      planId: plan.id,
      shippingId: input.customerShippingId ?? null,
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
      : computeEndAt({ startAt, durationMonths: plan.duration || 0 });

  const order = await makeOrder();

  const created = await repo.createSub({
    customerId: input.customerId,
    orderId: order.id,
    courseId: resolvedCourseId,
    packageId: resolvedPackageId,
    planId: plan.id,
    shippingId: input.customerShippingId ?? null,
    startAt,
    endAt,
    status: input.status,
    amount: computedAmount,
    courseAmount: plan.price ?? null,
    materialAmount: input.withMaterial ? (plan.materialPrice ?? 0) : null,
    payment_type: input.paymentType,
    remarks: input.remark ?? null,
    now,
  });
  return { ok: true, extended: wasExtension, data: await getCourseSubscriptionById(created.id) };
};

export const listPlansForTarget = async (courseId?: number, packageId?: number) => {
  const plans = await repo.plansForTarget({ courseId, packageId });
  return plans.map((p) => ({ _id: String(p.id), name: p.name ?? null, duration: p.duration, price: p.price, materialPrice: p.materialPrice ?? 0, withMaterial: p.withMaterial, isDefault: p.isDefault, status: p.status, courseId: idStr(p.courseId), packageId: idStr(p.packageId) }));
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
