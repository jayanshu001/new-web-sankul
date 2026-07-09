import ExcelJS from "exceljs";
import { computeEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminEbookRepository as repo } from "./admin-ebook.repository";
import { populateExamCountdowns, parseIdArray } from "../exam-countdown/exam-countdown.service";
import { PaymentMethod } from "@prisma/client";
import type { EBook, PackageCourseEbookPrice } from "@prisma/client";

export const ADMIN_EBOOK_MODULE = "admin-ebook";
export const isAdminEbookMysql = (): boolean => true;

export const parseEbookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Case-insensitive map to the PaymentMethod enum so the UI can send "backend"/"Backend".
const PAYMENT_METHOD_BY_LOWER: Record<string, PaymentMethod> = Object.fromEntries(
  Object.values(PaymentMethod).map((v) => [v.toLowerCase(), v])
);
export const coercePaymentMethod = (v?: string): PaymentMethod | undefined =>
  v ? PAYMENT_METHOD_BY_LOWER[v.trim().toLowerCase()] : undefined;

// "YYYY-MM-DD" → inclusive day bounds; `end` extends to the end of that day.
export const parseDateBound = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(`${v.trim()}${end ? "T23:59:59.999" : "T00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// ── transformers ─────────────────────────────────────────────────────────────
/**
 * `ws_ebook` row → admin Ebook DTO (Mongo `Ebook` shape). Field renames:
 * terms_and_conditions→termsAndConditions, order_by→order, demo_url→demoUrl,
 * book_url→bookUrl, link→link, book_file_name→bookFileName,
 * demo_file_name→demoFileName (original PDF upload names). SQL-absent fields
 * read from ws_ebook.is_trending; the PDF-upload status fields
 * (book/demoUploadStatus/Progress) are omitted (Mongo-only).
 *
 * examCountdown* are stored as JSON int-arrays on ws_ebook (C6) and populated on
 * DETAIL reads via `populateExamCountdowns` — pass the resolved DTOs as `ec`.
 * List/write paths leave them empty (no per-row populate fan-out).
 */
export const toEbookDto = (
  row: EBook,
  ec?: {
    examCountdownIds: { _id: string; title: string; examDate: Date }[];
    examCountdownCategoryIds: { _id: string; name: string; colorHex: string }[];
  }
) => ({
  _id: String(row.id),
  name: row.name,
  examCountdownCategoryId: ec ? ec.examCountdownCategoryIds[0] ?? null : null,
  examCountdownCategoryIds: ec ? ec.examCountdownCategoryIds : [],
  examCountdownIds: ec ? ec.examCountdownIds : [],
  thumbnail: row.thumbnail,
  image: row.image,
  description: row.description ?? null,
  termsAndConditions: row.termsAndConditions,
  author: row.author ?? null,
  publisher: row.publisher ?? null,
  language: row.language,
  order: row.orderby,
  demoUrl: row.bookDemoUrl,
  bookUrl: row.bookUrl,
  // Original upload filenames (persisted by the PDF-upload pipeline) so edit can
  // show the same name. Columns: book_file_name / demo_file_name.
  demoFileName: row.demoFileName ?? null,
  bookFileName: row.bookFileName ?? null,
  link: row.shareableLink,
  isTrending: row.isTrending,
  status: row.active,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const toPlanDto = (p: PackageCourseEbookPrice & { EBook?: { id: number; name: string } | null }) => ({
  _id: String(p.id),
  ebookId: p.ebookId != null && p.ebookId > 0 ? String(p.ebookId) : null,
  ebook: p.EBook ? { _id: String(p.EBook.id), name: p.EBook.name } : undefined,
  name: p.name ?? null,
  duration: p.duration,
  price: p.price,
  isDefault: p.isDefault,
  status: p.status,
  isMostPopular: (p as any).isMostPopular ?? false,
  mostPopularPinned: (p as any).mostPopularPinned ?? false,
  createdAt: p.created_at ?? null,
  updatedAt: p.updated_at ?? null,
});

const toCustomerDto = (c: { id: number; fullName: string | null; phoneNumber: string; emailAddress?: string | null } | null) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber, emailAddress: c.emailAddress ?? null };
};

const toEbookRefDto = (e: { id: number; name: string; image?: string | null; thumbnail?: string | null; author?: string | null } | null) =>
  e ? { _id: String(e.id), name: e.name, ...(e.image !== undefined ? { image: e.image ?? null } : {}), ...(e.thumbnail !== undefined ? { thumbnail: e.thumbnail ?? null } : {}), ...(e.author !== undefined ? { author: e.author ?? null } : {}) } : null;

// ── ebooks: list / get ─────────────────────────────────────────────────────────
export interface ListEbooksQuery { search?: string; author?: string; publisher?: string; language?: string; status?: string; page?: string; limit?: string }

export const listEbooks = async (query: ListEbooksQuery) => {
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "20", 10) || 20, 1), 100);
  const opts = {
    search: query.search,
    author: query.author,
    publisher: query.publisher,
    language: query.language,
    status: query.status === "true" ? true : query.status === "false" ? false : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (pageNum - 1) * limitNum, take: limitNum }),
    repo.count(opts),
  ]);
  // NB: wrap (not bare `rows.map(toEbookDto)`) so Array.map's index arg can't be
  // mistaken for the optional `ec` populate param. List rows leave examCountdown* empty.
  return { data: rows.map((r) => toEbookDto(r)), pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const getEbookById = async (id: number) => {
  const row = await repo.findById(id);
  if (!row) return null;
  const [plans, ec] = await Promise.all([
    repo.listPlans(id, { activeOnly: true }),
    // C6: resolve the stored JSON int-arrays to the Mongo .populate() shape.
    populateExamCountdowns(row),
  ]);
  return { ...toEbookDto(row, ec), plans: plans.map(toPlanDto) };
};

// ── ebooks: write ────────────────────────────────────────────────────────────
// ws_ebook NOT-NULL columns with no DB default → write-time sentinels.
export const createEbook = async (d: any) => {
  const now = new Date();
  const created = await repo.create({
    name: d.name,
    thumbnail: d.thumbnail ?? "",
    image: d.image ?? "",
    description: d.description ?? null,
    termsAndConditions: d.termsAndConditions ?? "",
    author: d.author ?? null,
    publisher: d.publisher ?? null,
    orderby: d.order ?? 0,
    language: d.language,
    bookDemoUrl: d.demoUrl ?? "",
    bookUrl: d.bookUrl ?? "",
    shareableLink: d.link ?? "",
    active: d.status ?? true,
    isTrending: d.isTrending ?? false,
    // C6: persist attached countdown/category ids (SQL ints) as JSON arrays.
    examCountdownIds: parseIdArray(d.examCountdownIds),
    examCountdownCategoryIds: parseIdArray(d.examCountdownCategoryIds),
    createdAt: now,
    updatedAt: now,
  });
  return toEbookDto(created);
};

export const updateEbook = async (id: number, d: any): Promise<ReturnType<typeof toEbookDto> | null> => {
  if (!(await repo.exists(id))) return null;
  const data: any = { updatedAt: new Date() };
  if (d.name !== undefined) data.name = d.name;
  if (d.thumbnail !== undefined) data.thumbnail = d.thumbnail ?? "";
  if (d.image !== undefined) data.image = d.image ?? "";
  if (d.description !== undefined) data.description = d.description;
  if (d.termsAndConditions !== undefined) data.termsAndConditions = d.termsAndConditions ?? "";
  if (d.author !== undefined) data.author = d.author;
  if (d.publisher !== undefined) data.publisher = d.publisher;
  if (d.order !== undefined) data.orderby = d.order;
  if (d.language !== undefined) data.language = d.language;
  if (d.demoUrl !== undefined) data.bookDemoUrl = d.demoUrl ?? "";
  if (d.bookUrl !== undefined) data.bookUrl = d.bookUrl ?? "";
  if (d.link !== undefined) data.shareableLink = d.link ?? "";
  if (d.status !== undefined) data.active = d.status;
  if (d.isTrending !== undefined) data.isTrending = d.isTrending;
  // C6: only touch the JSON arrays when the payload carries them (an update that
  // omits countdowns must not wipe the stored ids).
  if (d.examCountdownIds !== undefined) data.examCountdownIds = parseIdArray(d.examCountdownIds);
  if (d.examCountdownCategoryIds !== undefined) data.examCountdownCategoryIds = parseIdArray(d.examCountdownCategoryIds);
  const updated = await repo.update(id, data);
  return toEbookDto(updated);
};

export const deleteEbook = async (id: number): Promise<boolean> => {
  if (!(await repo.exists(id))) return false;
  await repo.delete(id);
  return true;
};

// Flip ws_ebook.is_trending. Returns the updated DTO, or null if not found.
export const toggleEbookTrending = async (id: number): Promise<ReturnType<typeof toEbookDto> | null> => {
  const row = await repo.findById(id);
  if (!row) return null;
  const updated = await repo.update(id, { isTrending: !row.isTrending, updatedAt: new Date() });
  return toEbookDto(updated);
};

export const reorderEbooks = async (orders: Array<{ id: string; order: number }>) => {
  await Promise.all(orders.map(({ id, order }) => {
    const numId = parseEbookId(id);
    return numId ? repo.setOrder(numId, order) : Promise.resolve();
  }));
};

// ── plans ──────────────────────────────────────────────────────────────────────
export const listEbookPlans = async (ebookId: number): Promise<"not_found" | any[]> => {
  if (!(await repo.exists(ebookId))) return "not_found";
  const plans = await repo.listPlans(ebookId);
  return plans.map(toPlanDto);
};

export const createEbookPlan = async (ebookId: number, d: { name?: string | null; duration: number; price: number; isDefault?: boolean; status?: boolean }): Promise<"not_found" | any> => {
  if (!(await repo.exists(ebookId))) return "not_found";
  const now = new Date();
  const created = await repo.createPlan({
    // ebook-owned: ebook_id set; course/package 0 sentinel (matches admin-plan).
    ebookId, courseId: 0, packageId: 0,
    name: d.name ?? null,
    duration: d.duration,
    price: d.price,
    withMaterial: false,
    materialPrice: 0,
    isDefault: d.isDefault ?? false,
    status: d.status ?? true,
    created_at: now, updated_at: now,
  });
  return toPlanDto(created);
};

export const getEbookPlanById = async (planId: number) => {
  const plan = await repo.findPlanById(planId);
  return plan ? toPlanDto(plan) : null;
};

export const updateEbookPlan = async (planId: number, d: { name?: string | null; duration?: number; price?: number; isDefault?: boolean; status?: boolean }): Promise<"not_found" | any> => {
  if (!(await repo.findPlanBare(planId))) return "not_found";
  const data: any = { updated_at: new Date() };
  if (d.name !== undefined) data.name = d.name;
  if (d.duration !== undefined) data.duration = d.duration;
  if (d.price !== undefined) data.price = d.price;
  if (d.isDefault !== undefined) data.isDefault = d.isDefault;
  if (d.status !== undefined) data.status = d.status;
  const updated = await repo.updatePlan(planId, data);
  return toPlanDto(updated);
};

export const deleteEbookPlan = async (planId: number): Promise<boolean> => {
  if (!(await repo.findPlanBare(planId))) return false;
  await repo.deletePlan(planId);
  return true;
};

// prices-for-subscription dropdown (active plans, minimal fields)
export const getEbookPricesForSubscription = async (ebookId: number): Promise<"not_found" | any[]> => {
  if (!(await repo.exists(ebookId))) return "not_found";
  const plans = await repo.listPlans(ebookId, { activeOnly: true });
  return plans.map((p) => ({ _id: String(p.id), name: p.name ?? null, price: p.price, duration: p.duration }));
};

// ── subscriptions ────────────────────────────────────────────────────────────
const toSubListItem = (r: any) => ({
  _id: String(r.id),
  customerId: toCustomerDto(r.customer),
  ebookId: toEbookRefDto(r.eBook),
  planId: r.eBookOrder?.PackageCourseEbookPrice
    ? { _id: String(r.eBookOrder.PackageCourseEbookPrice.id), name: r.eBookOrder.PackageCourseEbookPrice.name ?? null, duration: r.eBookOrder.PackageCourseEbookPrice.duration, price: r.eBookOrder.PackageCourseEbookPrice.price }
    : null,
  orderId: r.eBookOrder
    ? {
        _id: String(r.eBookOrder.id),
        paymentMethod: r.eBookOrder.paymentMethod,
        status: r.eBookOrder.status,
        // Razorpay identifiers for the report; empty gateway id (non-razorpay grant) → null.
        razorpayOrderId: r.eBookOrder.gatewayOrderId ? r.eBookOrder.gatewayOrderId : null,
        razorpayPaymentId: r.eBookOrder.gatewayPaymentId ?? null,
      }
    : null,
  paidAmount: r.eBookOrder?.orderPrice ?? (r.price != null ? Number(r.price) : 0),
  startAt: r.startAt ?? null,
  endAt: r.endAt ?? null,
  status: r.status,
  remarks: r.remarks ?? null,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export interface SubReportQuery {
  customerId?: number;
  ebookId?: number;
  status?: boolean;
  statusFilter?: "active" | "expired" | "inactive";
  paymentMethod?: PaymentMethod;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

// Shared filter resolution for the subscriptions list + its CSV/Excel exports, so
// all three honor the identical param contract. Returns null when a search matched
// nothing (force empty result, mirrors Mongo's $or over empty sets).
const resolveSubOpts = async (q: SubReportQuery) => {
  let customerIdsIn: number[] | undefined;
  let ebookIdsIn: number[] | undefined;
  if (q.search) {
    [customerIdsIn, ebookIdsIn] = await Promise.all([repo.findCustomerIdsBySearch(q.search), repo.findEbookIdsBySearch(q.search)]);
    if (!customerIdsIn.length && !ebookIdsIn.length) return null;
  }
  return {
    customerId: q.customerId, ebookId: q.ebookId, status: q.status,
    statusFilter: q.statusFilter, paymentMethod: q.paymentMethod,
    dateFrom: q.dateFrom, dateTo: q.dateTo, now: new Date(),
    customerIdsIn, ebookIdsIn,
    sortBy: q.sortBy ?? "createdAt", sortDir: (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
};

export const listSubscriptions = async (q: SubReportQuery & { page: number; limit: number }) => {
  const opts = await resolveSubOpts(q);
  if (!opts) return { items: [], total: 0 };
  const [rows, total] = await Promise.all([
    repo.listSubscriptions({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countSubscriptions(opts),
  ]);
  return { items: rows.map(toSubListItem), total };
};

// Full filtered set (no pagination) for the report exports. Capped defensively.
const EBOOK_SUB_EXPORT_MAX = 100000;

export const exportSubscriptionRows = async (q: SubReportQuery) => {
  const opts = await resolveSubOpts(q);
  if (!opts) return [];
  const rows = await repo.listSubscriptions({ ...opts, skip: 0, take: EBOOK_SUB_EXPORT_MAX });
  return rows.map(toSubListItem);
};

const fmtExportDate = (d: Date | string | null | undefined): string => (d ? new Date(d).toISOString() : "");
// Display status shown by the report table: mirrors the statusFilter semantics
// (inactive = not active; expired = active but endAt past; active = active & current).
const displaySubStatus = (i: ReturnType<typeof toSubListItem>, now: Date): string => {
  if (!i.status) return "inactive";
  if (i.endAt && new Date(i.endAt) < now) return "expired";
  return "active";
};

// Column order matches the report table (and the client's export).
const EBOOK_SUB_EXPORT_COLUMNS: { header: string; get: (i: any, now: Date) => string | number }[] = [
  { header: "Subscription ID", get: (i) => i._id ?? "" },
  { header: "Phone", get: (i) => i.customerId?.phoneNumber ?? "" },
  { header: "Customer Name", get: (i) => [i.customerId?.firstName, i.customerId?.lastName].filter(Boolean).join(" ") },
  { header: "Email", get: (i) => i.customerId?.emailAddress ?? "" },
  { header: "Ebook Name", get: (i) => i.ebookId?.name ?? "" },
  { header: "Razorpay Order Id", get: (i) => i.orderId?.razorpayOrderId ?? "" },
  { header: "Razorpay Payment Id", get: (i) => i.orderId?.razorpayPaymentId ?? "" },
  { header: "Start Date", get: (i) => fmtExportDate(i.startAt) },
  { header: "End Date", get: (i) => fmtExportDate(i.endAt) },
  { header: "Remarks", get: (i) => i.remarks ?? "" },
  { header: "Price", get: (i) => i.paidAmount ?? "" },
  { header: "Status", get: (i, now) => displaySubStatus(i, now) },
];

export const buildSubscriptionsCsv = async (q: SubReportQuery): Promise<string> => {
  const rows = await exportSubscriptionRows(q);
  const now = new Date();
  const esc = (v: string | number) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [EBOOK_SUB_EXPORT_COLUMNS.map((c) => esc(c.header)).join(",")];
  for (const r of rows) lines.push(EBOOK_SUB_EXPORT_COLUMNS.map((c) => esc(c.get(r, now))).join(","));
  return lines.join("\n");
};

export const buildSubscriptionsXlsx = async (q: SubReportQuery): Promise<Buffer> => {
  const rows = await exportSubscriptionRows(q);
  const now = new Date();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ebook Subscriptions");
  ws.columns = EBOOK_SUB_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 22 }));
  for (const r of rows) ws.addRow(EBOOK_SUB_EXPORT_COLUMNS.map((c) => c.get(r, now)));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

export const getSubscriptionById = async (id: number) => {
  const sub = await repo.findSubscriptionById(id);
  if (!sub) return null;
  return {
    _id: String(sub.id),
    customerId: toCustomerDto(sub.customer),
    ebookId: toEbookRefDto(sub.eBook),
    orderId: sub.eBookOrder
      ? { _id: String(sub.eBookOrder.id), paymentMethod: sub.eBookOrder.paymentMethod, orderPrice: sub.eBookOrder.orderPrice, status: sub.eBookOrder.status, planId: sub.eBookOrder.planId != null && sub.eBookOrder.planId > 0 ? String(sub.eBookOrder.planId) : null }
      : null,
    price: sub.price != null ? Number(sub.price) : 0,
    startAt: sub.startAt ?? null,
    endAt: sub.endAt ?? null,
    paymentType: sub.payment_type,
    status: sub.status,
    remarks: sub.remarks ?? null,
    createdAt: sub.createdAt ?? null,
    updatedAt: sub.updatedAt ?? null,
  };
};

export interface CreateSubInput {
  customerId: number;
  ebookId: number;
  planId?: number | null;
  durationInDays?: number;
  paymentMethod: string;
  orderPrice: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  transactionId?: string | null;
  ipAddress?: string | null;
  remarks?: string | null;
  status?: boolean;
}

export const createSubscription = async (d: CreateSubInput): Promise<{ ok: false; reason: "ebook" | "plan" } | { ok: true; data: any }> => {
  if (!(await repo.exists(d.ebookId))) return { ok: false, reason: "ebook" };

  let durationDays = d.durationInDays;
  let resolvedEbookId = d.ebookId;
  if (d.planId) {
    const plan = await repo.findPlanBare(d.planId);
    if (!plan) return { ok: false, reason: "plan" };
    durationDays = plan.duration;
    if (plan.ebookId && plan.ebookId > 0) resolvedEbookId = plan.ebookId;
  }

  const startAt = new Date();
  // `duration` is in DAYS (see [[project_plan_duration_unit]]) — endAt via the
  // planDuration helper (asDays), NOT raw ms math.
  const endAt = computeEndAt({ startAt, durationMonths: durationDays ?? 0, asDays: true });

  // unique_id business key (mirrors the client ebook-order key shape).
  const uniqueId = `ebook-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  const { order, subscription } = await repo.createBackendSubscription({
    uniqueId,
    customerId: d.customerId,
    ebookId: resolvedEbookId,
    planId: d.planId ?? null,
    paymentMethod: d.paymentMethod,
    orderPrice: d.orderPrice,
    razorpayOrderId: d.razorpayOrderId ?? null,
    razorpayPaymentId: d.razorpayPaymentId ?? null,
    transactionId: d.transactionId ?? null,
    ipAddress: d.ipAddress ?? null,
    price: d.orderPrice,
    startAt,
    endAt,
    remarks: d.remarks ?? null,
    status: d.status ?? true,
  });

  return { ok: true, data: { order: { ...order, orderPrice: order.orderPrice }, subscription } };
};

export const updateSubscription = async (
  id: number,
  d: { razorpayOrderId?: string; razorpayPaymentId?: string; remarks?: string | null; status?: boolean }
): Promise<"not_found" | "order_not_found" | "already_active" | { order?: any; subscription: any }> => {
  const sub = await repo.findSubscriptionBare(id);
  if (!sub) return "not_found";

  const isVerifyOrder = d.razorpayOrderId !== undefined || d.razorpayPaymentId !== undefined;

  if (!isVerifyOrder) {
    // Toggle path: patch status/remarks only.
    const data: any = {};
    if (d.status !== undefined) data.status = d.status;
    if (d.remarks !== undefined) data.remarks = d.remarks ?? null;
    const subscription = await repo.updateSubscription(id, data);
    return { subscription };
  }

  // Verify-order path: mark the pending order complete.
  if (sub.orderId == null) return "order_not_found";
  const order = await repo.findOrderById(sub.orderId);
  if (!order) return "order_not_found";
  if (order.status === "complete") return "already_active";

  const updatedOrder = await repo.updateOrder(order.id, {
    gatewayOrderId: d.razorpayOrderId ?? "",
    gatewayPaymentId: d.razorpayPaymentId ?? null,
    status: "complete",
  });

  const subData: any = {};
  if (d.status !== undefined) subData.status = d.status;
  if (d.remarks !== undefined) subData.remarks = d.remarks ?? null;
  const subscription = Object.keys(subData).length ? await repo.updateSubscription(id, subData) : sub;

  return { order: updatedOrder, subscription };
};

export const deleteSubscription = async (id: number): Promise<boolean> => {
  if (!(await repo.findSubscriptionBare(id))) return false;
  await repo.deleteSubscription(id);
  return true;
};
