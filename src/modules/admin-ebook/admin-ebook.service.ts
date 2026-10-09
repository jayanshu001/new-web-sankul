// Admin ebooks: ebook, plan and subscription management plus subscription report/exports.
import ExcelJS from "exceljs";
import { countPlanUsage, countPlanUsageOne } from "../../utils/planUsage";
import { nextOrder } from "../../utils/listOrdering";
import { prisma } from "../../config/prisma";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import type { ReportSource } from "../../utils/reportStream";
import { computeEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminEbookRepository as repo } from "./admin-ebook.repository";
import { populateExamCountdowns, parseIdArray } from "../exam-countdown/exam-countdown.service";
import { PaymentMethod } from "@prisma/client";
import type { EBook, PackageCourseEbookPrice } from "@prisma/client";
import { buildPagination, parseListQuery } from "../../utils/listQuery";
import { fmtExportDate } from "../../utils/csvExport";
import { appendAdminRemark, planAddDays } from "../../utils/subscriptionRemarkHistory";
import { adminSubscriptionRepository } from "../admin-subscription/admin-subscription.repository";
import { parsePositiveInt } from "../../utils/parseId";


export const parseEbookId = parsePositiveInt;

// Case-insensitive map so the UI can send "backend"/"Backend".
const PAYMENT_METHOD_BY_LOWER: Record<string, PaymentMethod> = Object.fromEntries(
  Object.values(PaymentMethod).map((v) => [v.toLowerCase(), v])
);
export const coercePaymentMethod = (v?: string): PaymentMethod | undefined =>
  v ? PAYMENT_METHOD_BY_LOWER[v.trim().toLowerCase()] : undefined;

// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to → 23:59:59.999
// at +05:30) so a calendar pick covers the full IST day; a naive UTC parse drops the
// last 5.5h. Full timestamps pass through.
export const parseDateBound = (v: string | undefined, end: boolean): Date | undefined => {
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

/**
 * PDF-upload status is persisted on ws_ebook so list/edit screens render queued →
 * in_progress → completed after a refresh, independent of the Socket.io room.
 * examCountdown*: detail reads pass the resolved DTOs as `ec` for the populated
 * shape; without `ec` the raw id arrays are emitted (as ws_package does via
 * admin-package.service.ts `jsonIdsToStrings`).
 */
const jsonIdsToStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : [];

export const toEbookDto = (
  row: EBook,
  ec?: {
    examCountdownIds: { _id: string; title: string; examDate: Date }[];
    examCountdownCategoryIds: { _id: string; name: string; colorHex: string }[];
  }
) => ({
  _id: String(row.id),
  name: row.name,
  examCountdownCategoryId: ec
    ? ec.examCountdownCategoryIds[0] ?? null
    : jsonIdsToStrings(row.examCountdownCategoryIds)[0] ?? null,
  examCountdownCategoryIds: ec ? ec.examCountdownCategoryIds : jsonIdsToStrings(row.examCountdownCategoryIds),
  examCountdownIds: ec ? ec.examCountdownIds : jsonIdsToStrings(row.examCountdownIds),
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
  // Original upload filenames (persisted by the PDF-upload pipeline) so edit can show them.
  demoFileName: row.demoFileName ?? null,
  bookFileName: row.bookFileName ?? null,
  // Written by the BullMQ pipeline (pdfUpload.scheduler); queued | in_progress |
  // completed | failed, null = never uploaded. updateEbook resets the whole slot when a
  // URL is cleared, so "completed" always means the matching url is set.
  bookUploadStatus: row.bookUploadStatus ?? null,
  bookUploadProgress: row.bookUploadProgress ?? 0,
  demoUploadStatus: row.demoUploadStatus ?? null,
  demoUploadProgress: row.demoUploadProgress ?? 0,
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
  isMostPopular: (p as any).isMostPopular ?? false, // computed, read-only (plan-popularity)
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

export interface ListEbooksQuery { search?: string; author?: string; publisher?: string; language?: string; status?: string; page?: string; limit?: string }

export const listEbooks = async (query: ListEbooksQuery) => {
  const { page: pageNum, limit: limitNum } = parseListQuery({ page: query.page, limit: query.limit }, { defaultLimit: 20, maxLimit: 100 });
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
  // Wrapped (not bare `rows.map(toEbookDto)`) so Array.map's index arg can't be
  // mistaken for the optional `ec` param. List rows carry raw examCountdown* ids.
  return { data: rows.map((r) => toEbookDto(r)), pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const getEbookById = async (id: number) => {
  const row = await repo.findById(id);
  if (!row) return null;
  const [plans, ec] = await Promise.all([
    repo.listPlans(id, { activeOnly: true }),
    populateExamCountdowns(row),
  ]);
  return { ...toEbookDto(row, ec), plans: plans.map(toPlanDto) };
};

// ws_ebook NOT NULL columns with no DB default → write-time sentinels.
export const createEbook = async (d: any) => {
  const now = new Date();
  // No explicit order → previous row + 1 (see utils/listOrdering).
  const ebookOrder = d.order ?? nextOrder((await prisma.eBook.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderby: true } }))?.orderby);
  const created = await repo.create({
    name: d.name,
    thumbnail: d.thumbnail ?? "",
    image: d.image ?? "",
    description: d.description ?? null,
    termsAndConditions: d.termsAndConditions ?? "",
    author: d.author ?? null,
    publisher: d.publisher ?? null,
    orderby: ebookOrder,
    language: d.language,
    bookDemoUrl: d.demoUrl ?? "",
    bookUrl: d.bookUrl ?? "",
    // An empty slot must not carry a file name (same rule as updateEbook).
    demoFileName: d.demoUrl ? d.demoFileName ?? null : null,
    bookFileName: d.bookUrl ? d.bookFileName ?? null : null,
    shareableLink: d.link ?? "",
    active: d.status ?? true,
    isTrending: d.isTrending ?? false,
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
  // Clearing a PDF slot resets the whole slot in one write (url, file name, upload
  // status, progress) so stored state can't contradict itself (e.g. bookUrl "" with
  // status "completed"). `null` (JSON) and `""` (multipart) both mean cleared.
  if (d.demoUrl !== undefined) {
    data.bookDemoUrl = d.demoUrl ?? "";
    if (!d.demoUrl) {
      if (d.demoFileName === undefined) data.demoFileName = null;
      data.demoUploadStatus = null;
      data.demoUploadProgress = 0;
    }
  }
  if (d.bookUrl !== undefined) {
    data.bookUrl = d.bookUrl ?? "";
    if (!d.bookUrl) {
      if (d.bookFileName === undefined) data.bookFileName = null;
      data.bookUploadStatus = null;
      data.bookUploadProgress = 0;
    }
  }
  // Written only here and by the async upload pipeline (pdfUpload.scheduler).
  if (d.demoFileName !== undefined) data.demoFileName = d.demoFileName ?? null;
  if (d.bookFileName !== undefined) data.bookFileName = d.bookFileName ?? null;
  if (d.link !== undefined) data.shareableLink = d.link ?? "";
  if (d.status !== undefined) data.active = d.status;
  if (d.isTrending !== undefined) data.isTrending = d.isTrending;
  // Only touch the JSON arrays when the payload carries them, so an update that omits
  // countdowns doesn't wipe the stored ids.
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

export const listEbookPlans = async (
  ebookId: number,
  opts: { skip: number; take: number; page: number; limit: number }
): Promise<"not_found" | { data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  if (!(await repo.exists(ebookId))) return "not_found";
  const [plans, total] = await Promise.all([
    repo.listPlans(ebookId, { skip: opts.skip, take: opts.take }),
    repo.countPlans(ebookId),
  ]);
  // All-time, status-blind order count → the panel's Delete lock (one grouped query per page).
  const usage = await countPlanUsage("price", plans.map((pl) => pl.id));
  return {
    data: plans.map((pl) => ({ ...toPlanDto(pl), orderCount: usage.get(pl.id) ?? 0 })),
    pagination: buildPagination(total, opts.page, opts.limit),
  };
};

export const createEbookPlan = async (ebookId: number, d: { name?: string | null; duration: number; price: number; isDefault?: boolean; status?: boolean }): Promise<"not_found" | any> => {
  if (!(await repo.exists(ebookId))) return "not_found";
  const now = new Date();
  const created = await repo.createPlan({
    // Ebook-owned: ebook_id set; course/package 0 sentinel (matches admin-plan).
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

export const updateEbookPlan = async (planId: number, d: { name?: string | null; duration?: number; price?: number; isDefault?: boolean; status?: boolean }): Promise<"not_found" | "frozen_terms" | any> => {
  const existing = await repo.findPlanBare(planId);
  if (!existing) return "not_found";
  // Commercial terms are frozen once saved; only a real change is refused, so a form
  // re-sending the stored values still saves.
  if (
    (d.duration !== undefined && d.duration !== existing.duration) ||
    (d.price !== undefined && d.price !== existing.price)
  ) return "frozen_terms";
  const data: any = { updated_at: new Date() };
  if (d.name !== undefined) data.name = d.name;
  if (d.isDefault !== undefined) data.isDefault = d.isDefault;
  if (d.status !== undefined) data.status = d.status;
  const updated = await repo.updatePlan(planId, data);
  return toPlanDto(updated);
};

// Refuses while any order references the plan (returns { inUse }).
export const deleteEbookPlan = async (planId: number): Promise<"not_found" | { inUse: number } | true> => {
  if (!(await repo.findPlanBare(planId))) return "not_found";
  // Usage is counted via ws_ebook_order.plan_id. ws_ebook_subscription has no plan_id,
  // so an order-less legacy subscription can't be attributed (see utils/planUsage);
  // every real purchase writes an order.
  const inUse = await countPlanUsageOne("price", planId);
  if (inUse > 0) return { inUse };
  await repo.deletePromotedForPlan(planId);
  await repo.deletePlan(planId);
  return true;
};

// Prices-for-subscription dropdown (active plans, minimal fields).
export const getEbookPricesForSubscription = async (ebookId: number): Promise<"not_found" | any[]> => {
  if (!(await repo.exists(ebookId))) return "not_found";
  const plans = await repo.listPlans(ebookId, { activeOnly: true });
  return plans.map((p) => ({ _id: String(p.id), name: p.name ?? null, price: p.price, duration: p.duration }));
};

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
        // Empty gateway id (non-razorpay grant) → null.
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

// Shared filter resolution for the subscriptions list + its exports. Returns null when
// a search matched nothing (force empty result).
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

// Exports cover the entire filtered set with no row cap, keyset-paged (no deep OFFSET)
// and mapped per batch so memory stays bounded.
const EBOOK_SUB_EXPORT_BATCH = 5000;

async function* iterateSubExportRows(opts: any) {
  let beforeId: number | undefined;
  for (;;) {
    const rows = await repo.listSubscriptionsPageKeyset(opts, beforeId, EBOOK_SUB_EXPORT_BATCH);
    if (!rows.length) break;
    yield rows.map(toSubListItem);
    if (rows.length < EBOOK_SUB_EXPORT_BATCH) break;
    beforeId = rows[rows.length - 1].id;
  }
}

// Mirrors statusFilter: inactive = not active; expired = active but endAt past;
// active = active and current.
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
  const now = new Date();
  const opts = await resolveSubOpts(q);
  async function* rowBatches() {
    if (opts) {
      for await (const batch of iterateSubExportRows(opts)) {
        yield batch.map((r) => EBOOK_SUB_EXPORT_COLUMNS.map((c) => c.get(r, now)));
      }
    }
  }
  return buildCsvFromRowBatches(EBOOK_SUB_EXPORT_COLUMNS.map((c) => c.header), rowBatches());
};

export const buildSubscriptionsXlsx = async (q: SubReportQuery): Promise<Buffer> => {
  const now = new Date();
  const opts = await resolveSubOpts(q);
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  const finished = new Promise<void>((resolve, reject) => {
    pass.once("end", resolve);
    pass.once("error", reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet("Ebook Subscriptions");
  ws.columns = EBOOK_SUB_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 22 }));
  if (opts) {
    for await (const batch of iterateSubExportRows(opts)) {
      for (const r of batch) ws.addRow(EBOOK_SUB_EXPORT_COLUMNS.map((c) => c.get(r, now))).commit();
    }
  }
  ws.commit();
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
};

// Streamed export source (async job path); same rows/columns as the sync builders.
export async function ebookSubExportSource(q: SubReportQuery): Promise<ReportSource> {
  const now = new Date();
  const opts = await resolveSubOpts(q);
  return {
    worksheetName: "Ebook Subscriptions",
    headers: EBOOK_SUB_EXPORT_COLUMNS.map((c) => c.header),
    rowBatches: (async function* () {
      if (opts) {
        for await (const batch of iterateSubExportRows(opts)) {
          yield batch.map((r) => EBOOK_SUB_EXPORT_COLUMNS.map((c) => c.get(r, now)));
        }
      }
    })(),
  };
}

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
  // extend=true → the new row continues from the customer's active subscription for
  // this ebook (fresh grant if none).
  extend?: boolean;
  // Acting admin id (from the JWT) → audit columns.
  actingAdminId?: number | null;
}

// Admin grant/extend: always a new order + subscription row; extend starts at the active endAt.
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

  const now = new Date();

  // Extend: the new row starts where the current active subscription ends. One order =
  // one subscription row; the existing row is never modified (updating it in place
  // orphaned the original purchase). No active sub → fresh grant starting now.
  const existing = d.extend ? await repo.findActiveSubscription(d.customerId, resolvedEbookId, now) : null;
  const startAt = existing?.endAt && existing.endAt.getTime() > now.getTime() ? new Date(existing.endAt) : now;
  // `duration` is in days; endAt via the planDuration helper (asDays), not raw ms math.
  const endAt = computeEndAt({ startAt, durationMonths: durationDays ?? 0, asDays: true });

  // unique_id business key (same shape as the client ebook-order key).
  const uniqueId = `ebook-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  const orderInput = {
    uniqueId,
    customerId: d.customerId,
    ebookId: resolvedEbookId,
    planId: d.planId ?? null,
    paymentMethod: d.paymentMethod,
    // The order row always carries a number (0 for a free extend); it is the purchase record.
    orderPrice: d.orderPrice ?? 0,
    razorpayOrderId: d.razorpayOrderId ?? null,
    razorpayPaymentId: d.razorpayPaymentId ?? null,
    transactionId: d.transactionId ?? null,
    ipAddress: d.ipAddress ?? null,
    // The new row's own price; a free "Add Days" extension is worth 0. The earlier row
    // keeps what it was paid since it is never written.
    price: d.orderPrice ?? 0,
    startAt,
    endAt,
    remarks: d.remarks ?? null,
    status: d.status ?? true,
    actingAdminId: d.actingAdminId ?? null,
  };

  // First grant or extension differ only in `startAt`.
  const { order, subscription } = await repo.createBackendSubscription(orderInput);

  return { ok: true, data: { order: { ...order, orderPrice: order.orderPrice }, subscription } };
};

export const addSubscriptionDays = async (
  id: number,
  input: { days: number; remark?: string | null; actingAdminId?: number | null }
) => {
  const existing = await repo.findSubscriptionBare(id);
  if (!existing) return null;

  const now = new Date();
  const addition = planAddDays(existing, input.days, now);
  const remarks = await appendAdminRemark(
    existing.remarks,
    { what: addition.what, remark: input.remark, actingAdminId: input.actingAdminId, now },
    adminSubscriptionRepository.adminUsersByIds
  );

  const subscription = await repo.updateSubscription(id, {
    endAt: addition.endAt,
    remarks,
    ...(input.actingAdminId != null ? { updated_by: input.actingAdminId } : {}),
  });
  return { customerId: existing.customerId, subscription };
};

export const updateSubscription = async (
  id: number,
  d: { razorpayOrderId?: string; razorpayPaymentId?: string; remarks?: string | null; status?: boolean; startAt?: string; endAt?: string; actingAdminId?: number | null }
): Promise<"not_found" | "order_not_found" | "already_active" | "bad_start" | "bad_end" | { order?: any; subscription: any }> => {
  const sub = await repo.findSubscriptionBare(id);
  if (!sub) return "not_found";

  const isVerifyOrder = d.razorpayOrderId !== undefined || d.razorpayPaymentId !== undefined;

  if (!isVerifyOrder) {
    // Toggle path: patch status/remarks only.
    const data: any = {};
    if (d.status !== undefined) data.status = d.status;
    if (d.remarks !== undefined) data.remarks = d.remarks ?? null;
    // Date edits end a subscription on a chosen day (status:false ends it outright).
    // Invalid input is rejected, never silently dropped.
    if (d.startAt !== undefined) {
      const dt = new Date(d.startAt);
      if (isNaN(dt.getTime())) return "bad_start";
      data.startAt = dt;
    }
    if (d.endAt !== undefined) {
      const dt = new Date(d.endAt);
      if (isNaN(dt.getTime())) return "bad_end";
      data.endAt = dt;
    }
    // Admin edit → stamp updated_by (created_by unchanged).
    if (d.actingAdminId != null) data.updated_by = d.actingAdminId;
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
  if (d.actingAdminId != null) subData.updated_by = d.actingAdminId;
  const subscription = Object.keys(subData).length ? await repo.updateSubscription(id, subData) : sub;

  return { order: updatedOrder, subscription };
};


/**
 * Read before an admin revoke (status flip / date change / delete) so the caller can
 * flush that customer's route cache; after delete the row is gone.
 */
export const getSubscriptionCustomerId = async (id: number): Promise<number | null> =>
  (await repo.findSubscriptionCustomerId(id))?.customerId ?? null;

export const deleteSubscription = async (id: number): Promise<boolean> => {
  if (!(await repo.findSubscriptionBare(id))) return false;
  await repo.deleteSubscription(id);
  return true;
};
