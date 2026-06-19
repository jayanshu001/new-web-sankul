import { isMysqlModule } from "../../config/migration";
import { computeEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminEbookRepository as repo } from "./admin-ebook.repository";
import { populateExamCountdowns, parseIdArray } from "../exam-countdown/exam-countdown.service";
import type { EBook, PackageCourseEbookPrice } from "@prisma/client";

export const ADMIN_EBOOK_MODULE = "admin-ebook";
export const isAdminEbookMysql = (): boolean => isMysqlModule(ADMIN_EBOOK_MODULE);

export const parseEbookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── transformers ─────────────────────────────────────────────────────────────
/**
 * `ws_ebook` row → admin Ebook DTO (Mongo `Ebook` shape). Field renames:
 * terms_and_conditions→termsAndConditions, order_by→order, demo_url→demoUrl,
 * book_url→bookUrl, link→link. SQL-absent fields synthesized: isTrending=false,
 * demoFileName/bookFileName=null, and the PDF-upload status fields
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
  demoFileName: null,
  bookFileName: null,
  link: row.shareableLink,
  isTrending: false,
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
  orderId: r.eBookOrder ? { _id: String(r.eBookOrder.id), paymentMethod: r.eBookOrder.paymentMethod, status: r.eBookOrder.status } : null,
  paidAmount: r.eBookOrder?.orderPrice ?? (r.price != null ? Number(r.price) : 0),
  startAt: r.startAt ?? null,
  endAt: r.endAt ?? null,
  status: r.status,
  remarks: r.remarks ?? null,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export const listSubscriptions = async (q: { customerId?: number; ebookId?: number; status?: boolean; search?: string; sortBy?: string; sortOrder?: string; page: number; limit: number }) => {
  let customerIdsIn: number[] | undefined;
  let ebookIdsIn: number[] | undefined;
  if (q.search) {
    [customerIdsIn, ebookIdsIn] = await Promise.all([repo.findCustomerIdsBySearch(q.search), repo.findEbookIdsBySearch(q.search)]);
    // No match at all → force an empty result (mirrors Mongo's $or over empty sets).
    if (!customerIdsIn.length && !ebookIdsIn.length) return { items: [], total: 0 };
  }
  const opts = {
    customerId: q.customerId, ebookId: q.ebookId, status: q.status,
    customerIdsIn, ebookIdsIn,
    sortBy: q.sortBy ?? "createdAt", sortDir: (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
  const [rows, total] = await Promise.all([
    repo.listSubscriptions({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countSubscriptions(opts),
  ]);
  return { items: rows.map(toSubListItem), total };
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
