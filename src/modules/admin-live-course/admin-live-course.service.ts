import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import type { ReportSource } from "../../utils/reportStream";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import { andWhere, statusWhere, normalizeStatus, reportRow } from "../../utils/reportFilters";
import { adminAuthRepository } from "../admin-auth/admin-auth.repository";
import { deriveRole } from "../admin-auth/admin-auth.transformer";
import type { LiveCourse, LiveCoursePlan, LiveCourseSubscription, LiveSession, Prisma } from "@prisma/client";
import { getVodStreamMeta } from "../../admin/live/streamos.service";
import { redisClient } from "../../config/redis";
import { buildPagination } from "../../utils/listQuery";
import { nextOrder } from "../../utils/listOrdering";
import { buildPrismaSearch, matchesAllTokens } from "../../utils/searchFilter";
import { buildPreviewTrackingId } from "../../utils/previewTracking";

export const LIVE_COURSE_MODULE = "live-course";
export const isLiveCourseMysql = (): boolean => true;

export const parseLiveId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStrOrNull = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);
const jArr = (v: any): any[] => (Array.isArray(v) ? v : []);

// Synthetic ids for JSON schedule folders/entries (Mongo addresses subdoc _id).
let _seq = 0;
const synthId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(_seq++).toString(36)}${Math.floor(performance.now()).toString(36)}`;

// ── transformers ─────────────────────────────────────────────────────────────
export const toCourseDto = (row: LiveCourse) => ({
  _id: String(row.id),
  name: row.name,
  subtitle: row.subtitle ?? "",
  description: row.description ?? null,
  image: row.image ?? null,
  ordered: row.ordered,
  shareableLink: row.shareableLink ?? "",
  withMaterial: row.withMaterial ?? "",
  withoutMaterial: row.withoutMaterial ?? "",
  classType: row.classType,
  status: row.status,
  isPaid: row.isPaid,
  isPopular: row.isPopular,
  courseEducatorId: idStrOrNull(row.educatorId),
  courseSubjectCategoryId: idStrOrNull(row.courseSubjectCategoryId),
  videoCategoryId: idStrOrNull(row.videoCategoryId),
  packageCategoryId: idStrOrNull(row.packageCategoryId),
  createdBy: idStrOrNull(row.createdBy),
  startTime: row.startTime ?? null,
  scheduleEntries: jArr(row.scheduleEntries),
  scheduleFolders: jArr(row.scheduleFolders),
  timetableFiles: jArr(row.timetableFiles),
  examCountdownCategoryIds: jArr(row.examCountdownCategoryIds),
  examCountdownIds: jArr(row.examCountdownIds),
  materialCategories: jArr(row.materialCategories),
  examCategories: jArr(row.examCategories),
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const toPlanDto = (p: LiveCoursePlan) => ({
  _id: String(p.id),
  liveCourseId: String(p.liveCourseId),
  name: p.name ?? null,
  duration: p.duration,
  price: p.price,
  originalPrice: p.originalPrice ?? null,
  withMaterial: p.withMaterial ?? false,
  materialPrice: p.materialPrice ?? null,
  isDefault: p.isDefault,
  status: p.status,
  isMostPopular: (p as any).isMostPopular ?? false,
  mostPopularPinned: (p as any).mostPopularPinned ?? false,
  createdAt: p.createdAt ?? null,
  updatedAt: p.updatedAt ?? null,
});

const toSessionDto = (s: LiveSession) => ({
  _id: String(s.id),
  title: s.title ?? null,
  subject: s.subject ?? null,
  scheduledAt: s.scheduledAt ?? null,
  endAt: s.endAt ?? null,
  status: s.status,
  streamId: s.streamId ?? null,
  hlsUrl: s.hlsUrl ?? null,
  recordings: jArr(s.recordings),
  createdAt: s.createdAt ?? null,
  updatedAt: s.updatedAt ?? null,
});

// ── courses: CRUD ──────────────────────────────────────────────────────────────
export interface ListLiveCoursesQuery { search?: string; status?: string; page?: string; limit?: string }

export const listLiveCourses = async (q: ListLiveCoursesQuery) => {
  const page = Math.max(1, parseInt(q.page as any) || 1);
  const limit = Math.min(100, parseInt(q.limit as any) || 20);
  const opts = { search: q.search, status: q.status === "true" ? true : q.status === "false" ? false : undefined };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (page - 1) * limit, take: limit }),
    repo.count(opts),
  ]);
  return { liveCourses: rows.map(toCourseDto), total, page, limit };
};

export const getLiveCourseById = async (id: number): Promise<"not_found" | { liveCourse: any }> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";
  return { liveCourse: toCourseDto(row) };
};

export const createLiveCourse = async (v: any, createdById?: string) => {
  const now = new Date();
  // Root-folder automation (VideoCategory{liveCourseId}) is Mongo-only — skipped.
  // No explicit `ordered` → previous row + 1 (utils/listOrdering). The admin list
  // sorts by recency and is unaffected.
  const ordered = v.ordered ?? nextOrder(await repo.prevOrdered());
  const created = await repo.create({
    name: v.name, subtitle: v.subtitle ?? null, description: v.description ?? null, image: v.image ?? null,
    ordered, shareableLink: v.shareableLink ?? null, withMaterial: v.withMaterial ?? null,
    withoutMaterial: v.withoutMaterial ?? null, classType: v.classType ?? "live",
    status: v.status !== false, isPaid: v.isPaid !== false, isPopular: !!v.isPopular,
    educatorId: v.courseEducatorId ? parseLiveId(v.courseEducatorId) : null,
    courseSubjectCategoryId: v.courseSubjectCategoryId ? parseLiveId(v.courseSubjectCategoryId) : null,
    videoCategoryId: null,
    packageCategoryId: v.packageCategoryId ? parseLiveId(v.packageCategoryId) : null,
    createdBy: createdById ? parseLiveId(createdById) : null,
    startTime: v.startTime ? new Date(v.startTime) : null,
    scheduleEntries: v.scheduleEntries ?? undefined, scheduleFolders: v.scheduleFolders ?? undefined,
    timetableFiles: v.timetableFiles ?? undefined,
    examCountdownCategoryIds: v.examCountdownCategoryIds ?? undefined, examCountdownIds: v.examCountdownIds ?? undefined,
    materialCategories: v.materialCategories ?? undefined, examCategories: v.examCategories ?? undefined,
    createdAt: now, updatedAt: now,
  });
  // rootFolder is Mongo-only (no live_course_id on ws_video_category) → null.
  return { liveCourse: toCourseDto(created), rootFolder: null };
};

/**
 * Bulk drag-and-drop reorder. Mirrors the banners contract
 * (banner-slider.service.reorderBanners): unparseable ids are skipped, the
 * returned count is how many rows were written, and 0 means "no valid ids" —
 * which the controller turns into a 400.
 *
 * One transaction for the whole batch: a 20-row drag must not be 20 independent
 * requests that can half-apply.
 */
export const reorderLiveCourses = async (
  orders: { id: string; ordered: number }[]
): Promise<number> => {
  const ops = orders
    .map((o) => ({ id: parseLiveId(o.id), ordered: o.ordered }))
    .filter((o): o is { id: number; ordered: number } => o.id !== null);
  if (!ops.length) return 0;
  await repo.reorder(ops);
  return ops.length;
};

export const updateLiveCourse = async (id: number, v: any): Promise<"not_found" | { liveCourse: any }> => {
  if (!(await repo.exists(id))) return "not_found";
  const data: any = { updatedAt: new Date() };
  if (v.name !== undefined) data.name = v.name;
  if (v.subtitle !== undefined) data.subtitle = v.subtitle;
  if (v.description !== undefined) data.description = v.description;
  if (v.image !== undefined) data.image = v.image;
  if (v.ordered !== undefined) data.ordered = v.ordered;
  if (v.shareableLink !== undefined) data.shareableLink = v.shareableLink;
  if (v.withMaterial !== undefined) data.withMaterial = v.withMaterial;
  if (v.withoutMaterial !== undefined) data.withoutMaterial = v.withoutMaterial;
  if (v.classType !== undefined) data.classType = v.classType;
  if (v.status !== undefined) data.status = v.status;
  if (v.isPaid !== undefined) data.isPaid = v.isPaid;
  if (v.isPopular !== undefined) data.isPopular = v.isPopular;
  if (v.courseEducatorId !== undefined) data.educatorId = v.courseEducatorId ? parseLiveId(v.courseEducatorId) : null;
  if (v.courseSubjectCategoryId !== undefined) data.courseSubjectCategoryId = v.courseSubjectCategoryId ? parseLiveId(v.courseSubjectCategoryId) : null;
  if (v.packageCategoryId !== undefined) data.packageCategoryId = v.packageCategoryId ? parseLiveId(v.packageCategoryId) : null;
  if (v.startTime !== undefined) data.startTime = v.startTime ? new Date(v.startTime) : null;
  if (v.timetableFiles !== undefined) data.timetableFiles = v.timetableFiles;
  if (v.examCountdownCategoryIds !== undefined) data.examCountdownCategoryIds = v.examCountdownCategoryIds;
  if (v.examCountdownIds !== undefined) data.examCountdownIds = v.examCountdownIds;
  if (v.materialCategories !== undefined) data.materialCategories = v.materialCategories;
  if (v.examCategories !== undefined) data.examCategories = v.examCategories;
  const updated = await repo.update(id, data);
  return { liveCourse: toCourseDto(updated) };
};

export const deleteLiveCourse = async (id: number): Promise<"not_found" | "has_sessions" | { id: string; deletedFolders: number; deletedVideos: number; deletedRelations: number }> => {
  if (!(await repo.exists(id))) return "not_found";
  // Block if sessions attached (mirror Mongo). Folders/videos are Mongo-only → 0.
  const sessions = await repo.sessionsForCourse(id, { now: new Date(), skip: 0, take: 1 });
  if (sessions.total > 0) return "has_sessions";
  await repo.delete(id);
  return { id: String(id), deletedFolders: 0, deletedVideos: 0, deletedRelations: 0 };
};

export const togglePopular = async (id: number): Promise<"not_found" | { id: string; isPopular: boolean }> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";
  const updated = await repo.update(id, { isPopular: !row.isPopular, updatedAt: new Date() });
  return { id: String(id), isPopular: updated.isPopular };
};

export const sessionCount = async (id: number) => (await repo.sessionsForCourse(id, { now: new Date(), skip: 0, take: 1 })).total;

// ── sessions for a course ────────────────────────────────────────────────────
export const listSessionsForCourse = async (id: number, q: { status?: string; upcoming?: string; search?: string; page?: string; limit?: string }): Promise<"not_found" | { sessions: any[]; total: number; page: number; limit: number }> => {
  if (!(await repo.exists(id))) return "not_found";
  const page = Math.max(1, parseInt(q.page as any) || 1);
  const limit = Math.min(100, parseInt(q.limit as any) || 50);
  const search = typeof q.search === "string" && q.search.trim() ? q.search.trim() : undefined;
  const { rows, total } = await repo.sessionsForCourse(id, {
    status: typeof q.status === "string" ? q.status : undefined,
    upcoming: q.upcoming === "true", search, now: new Date(), skip: (page - 1) * limit, take: limit,
  });
  return { sessions: rows.map(toSessionDto), total, page, limit };
};

// ── plans ──────────────────────────────────────────────────────────────────────
export const listPlans = async (
  liveCourseId: number,
  opts: { skip: number; take: number; page: number; limit: number }
): Promise<{ data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  const [plans, total] = await Promise.all([
    repo.listPlans(liveCourseId, opts.skip, opts.take),
    repo.countPlans(liveCourseId),
  ]);
  return { data: plans.map(toPlanDto), pagination: buildPagination(total, opts.page, opts.limit) };
};

export const createPlan = async (liveCourseId: number, v: any): Promise<"not_found" | any> => {
  if (!(await repo.exists(liveCourseId))) return "not_found";
  const now = new Date();
  if (v.isDefault) await repo.clearDefaultPlans(liveCourseId);
  const created = await repo.createPlan({
    liveCourseId, name: v.name ?? null, duration: v.duration, price: v.price,
    originalPrice: v.originalPrice ?? null, withMaterial: !!v.withMaterial,
    materialPrice: v.materialPrice ?? null, isDefault: !!v.isDefault, status: v.status !== false,
    createdAt: now, updatedAt: now,
  });
  return toPlanDto(created);
};

export const getPlan = async (planId: number): Promise<"not_found" | any> => {
  const p = await repo.findPlanById(planId);
  return p ? toPlanDto(p) : "not_found";
};

export const updatePlan = async (planId: number, v: any): Promise<"not_found" | any> => {
  const plan = await repo.findPlanById(planId);
  if (!plan) return "not_found";
  if (v.isDefault === true) await repo.clearDefaultPlans(plan.liveCourseId, planId);
  const data: any = { updatedAt: new Date() };
  for (const k of ["name", "duration", "price", "originalPrice", "withMaterial", "materialPrice", "isDefault", "status"]) if (v[k] !== undefined) data[k] = v[k];
  const updated = await repo.updatePlan(planId, data);
  return toPlanDto(updated);
};

export const deletePlan = async (planId: number): Promise<"not_found" | "has_subs" | true> => {
  if (!(await repo.findPlanById(planId))) return "not_found";
  if ((await repo.verifiedSubCountForPlan(planId)) > 0) return "has_subs";
  await repo.deletePlan(planId);
  return true;
};

// ── subscriptions ──────────────────────────────────────────────────────────────
const hydrateSubs = async (rows: LiveCourseSubscription[]) => {
  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x) => x > 0))])).map((c) => [c.id, c]));
  const courses = new Map((await repo.coursesByIds([...new Set(rows.map((r) => r.liveCourseId))])).map((c) => [c.id, c]));
  const plans = new Map((await repo.plansByIds([...new Set(rows.map((r) => r.planId).filter((x): x is number => x != null))])).map((p) => [p.id, p]));
  return rows.map((r) => {
    const c = custs.get(r.customerId);
    const name = c ? splitFullName(c.fullName) : null;
    const course = courses.get(r.liveCourseId);
    const plan = r.planId != null ? plans.get(r.planId) : undefined;
    return {
      _id: String(r.id),
      customerId: c && name ? { _id: String(c.id), firstName: name.firstName, lastName: name.lastName, phoneNumber: c.phoneNumber, emailAddress: c.emailAddress ?? null } : idStrOrNull(r.customerId),
      liveCourseId: course ? { _id: String(course.id), name: course.name, image: course.image ?? null } : idStrOrNull(r.liveCourseId),
      planId: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: plan.price } : idStrOrNull(r.planId),
      startAt: r.startAt ?? null, endAt: r.endAt ?? null, status: r.status,
      paidAmount: r.paidAmount ?? 0, paymentStatus: r.paymentStatus ?? null, paidAt: r.paidAt ?? null,
      createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
    };
  });
};

// ── subscription list (Reports contract) ─────────────────────────────────────
// Shared contract across the 4 admin subscription reports — see
// docs/REPORTS_SUBSCRIPTIONS_ADMIN.md. Returns { summary, data, pagination };
// summary respects all filters but ignores pagination. `status` here is the
// normalized active|expired|inactive (not the raw boolean); paymentMethod is the
// coarse online|backend (online = razorpay_order_id present). amount = paid_amount.

// Param contract shared by the list + its CSV/Excel exports (docs/backend-requests/
// live-course-report-detailed-export.md). All string-typed (query params).
export interface SubReportQuery {
  liveCourseId?: string; customerId?: string; status?: string; paymentMethod?: string;
  activationType?: string; dateFrom?: string; dateTo?: string; startFrom?: string; endTo?: string;
  search?: string; sortBy?: string; sortOrder?: string;
}

const coercePayMethod = (v?: string): "online" | "backend" | undefined =>
  v === "online" ? "online" : v === "backend" ? "backend" : undefined;

// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to →
// 23:59:59.999 at Asia/Kolkata, +05:30); full timestamps pass through. The
// createdAt date filter honors IST day boundaries (a naive UTC parse would drop
// the last 5.5h of the day). Invalid → undefined (no bound). Mirrors the
// Subscription + Test Series reports.
const parseDayBoundIst = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// Shared filter resolution for the subscriptions list + its CSV/Excel exports, so
// all three honor an identical param contract. Returns the composed `where` (base
// filters AND normalized-status fragment) + sort, or a discriminated string for a
// bad id / a search that matched nothing.
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
    customerIdsIn = await repo.customerIdsByText(q.search);
    if (!customerIdsIn.length) return "empty";
  }

  const base = repo.buildSubBaseWhere({
    customerId, liveCourseId,
    // activationType shares the online|backend semantics (razorpay_order_id
    // presence); paymentMethod wins when both are sent.
    paymentMethod: coercePayMethod(q.paymentMethod) ?? coercePayMethod(q.activationType),
    fromDate: parseDayBoundIst(q.dateFrom, false),
    toDate: parseDayBoundIst(q.dateTo, true),
    startFrom: q.startFrom ? new Date(q.startFrom) : undefined,
    endTo: q.endTo ? new Date(q.endTo) : undefined,
    customerIdsIn,
  });
  const listWhere = andWhere(base, statusWhere(q.status, now));
  const sortBy = q.sortBy ?? "createdAt";
  const sortDir = (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc";
  return { listWhere, sortBy, sortDir };
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

  const data = rows.map((r) => {
    const course = courses.get(r.liveCourseId);
    const plan = r.planId != null ? plans.get(r.planId) : undefined;
    return reportRow({
      cust: r.customerId ? custs.get(r.customerId) : undefined,
      product: course ? { _id: String(course.id), type: "liveCourse" as const, name: course.name, image: course.image ?? null } : null,
      plan: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: Number(plan.price) } : null,
      amount: r.paidAmount != null ? Number(r.paidAmount) : 0,
      paymentMethod: r.razorpayOrderId ? "online" : "backend",
      status: normalizeStatus({ status: r.status, endAt: r.endAt }, now),
      startAt: r.startAt ?? null, endAt: r.endAt ?? null, createdAt: r.createdAt ?? null,
    });
  });

  return {
    summary: { totalCount: total, totalRevenue: Number(agg._sum.paidAmount ?? 0), activeCount, expiredCount },
    data,
    pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
  };
};

// ── subscription report export (CSV / Excel) ──────────────────────────────────
// Entire filtered set (no pagination) and NO row cap — paged in keyset batches
// (id DESC, no deep OFFSET) and mapped per batch so memory stays bounded (lakhs OK).
const LIVE_SUB_EXPORT_BATCH = 5000;

// One flat export row per subscription. Only fields the list already fetches (raw
// ws_live_course_subscription row + customer/course maps) are populated; columns
// the live-course subscription doesn't expose (educator/promocode/promoter/shipping/
// remarks/material split/ws-coin) stay empty — no extra Prisma joins are invented
// (docs/backend-requests/live-course-report-detailed-export.md).
const buildSubExportRow = (
  r: LiveCourseSubscription,
  cust: { id: number; fullName: string | null; phoneNumber: string | null; emailAddress: string | null } | undefined,
  course: { id: number; name: string } | undefined,
  now: Date
) => {
  const method = r.razorpayOrderId ? "online" : "backend";
  return {
    _id: String(r.id),
    customerName: (cust?.fullName ?? "").trim(),
    phone: cust?.phoneNumber ?? "",
    email: cust?.emailAddress ?? "",
    courseName: course?.name ?? "",
    startAt: r.startAt ?? null,
    endAt: r.endAt ?? null,
    amount: r.paidAmount != null ? Number(r.paidAmount) : 0,
    paymentMethod: method,
    activationType: method,
    razorpayOrderId: r.razorpayOrderId ?? "",
    razorpayPaymentId: r.razorpayPaymentId ?? "",
    status: normalizeStatus({ status: r.status, endAt: r.endAt }, now),
  };
};

// Map one keyset batch of raw subscription rows to export rows (resolve the
// customer/course maps for just that batch).
const mapSubExportBatch = async (rows: LiveCourseSubscription[], now: Date) => {
  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x) => x > 0))])).map((c) => [c.id, c]));
  const courses = new Map((await repo.coursesByIds([...new Set(rows.map((r) => r.liveCourseId))])).map((c) => [c.id, c]));
  return rows.map((r) => buildSubExportRow(r, r.customerId ? custs.get(r.customerId) : undefined, courses.get(r.liveCourseId), now));
};

// Walk the entire filtered set in keyset batches (no cap). `filter` is the resolved
// where+sort from resolveSubFilter (the caller handles bad-id/empty first).
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

// IST (Asia/Kolkata, +5:30, no DST) `YYYY-MM-DD HH:mm:ss`, e.g. "2026-10-06 00:01:21"
// — unified with the Subscription / Test Series exports (was raw UTC ISO).
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtExportDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
};

// Column order mirrors the detailed subscription report table. Values not exposed
// by a live-course subscription render as an empty string (per the request doc).
const LIVE_SUB_EXPORT_COLUMNS: { header: string; get: (i: ReturnType<typeof buildSubExportRow>) => string | number }[] = [
  { header: "Subscription ID", get: (i) => i._id },
  { header: "Customer Name", get: (i) => i.customerName },
  { header: "Phone", get: (i) => i.phone },
  { header: "Email", get: (i) => i.email },
  { header: "Course Name", get: (i) => i.courseName },
  { header: "Package Name", get: () => "" },
  { header: "Educator Name", get: () => "" },
  { header: "Promocode", get: () => "" },
  { header: "Promoter Name", get: () => "" },
  { header: "Start Date", get: (i) => fmtExportDate(i.startAt) },
  { header: "End Date", get: (i) => fmtExportDate(i.endAt) },
  { header: "Amount", get: (i) => i.amount },
  { header: "Course Amount", get: () => "" },
  { header: "Material Amount", get: () => "" },
  { header: "Ws Coin", get: () => "" },
  { header: "Material Type", get: () => "" },
  { header: "Activation Type", get: (i) => i.activationType },
  { header: "Order Method", get: (i) => i.paymentMethod },
  { header: "Order Id", get: (i) => i.razorpayOrderId },
  { header: "Payment Id", get: (i) => i.razorpayPaymentId },
  { header: "Bank Transaction Id", get: () => "" },
  { header: "Address", get: () => "" },
  { header: "City", get: () => "" },
  { header: "Pincode", get: () => "" },
  { header: "Remarks", get: () => "" },
  { header: "Activated By", get: () => "" },
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

// Streamed export source (async job path) — same rows/columns as the sync builders.
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

export const grantSubscription = async (liveCourseId: number, v: { customerId: string; planId?: string; durationDays?: number; durationMonths?: number; startAt?: string; endAt?: string; amount?: number; withMaterial?: boolean; customerShippingId?: string | null; remarks?: string | null; paymentMethod?: string; bankTransactionId?: string | null; razorpayOrderId?: string | null; razorpayPaymentId?: string | null; extend?: boolean; actingAdminId?: number | null }): Promise<{ ok: false; code: string; msg: string } | { ok: true; created: boolean; data: any }> => {
  if (!(await repo.exists(liveCourseId))) return { ok: false, code: "course", msg: "Live course not found." };
  const customerId = parseLiveId(v.customerId);
  // planId is optional: with a plan we derive the window (and validate it belongs
  // to this course); without one, amount + duration/endAt drive the grant.
  const planId = v.planId ? parseLiveId(v.planId) : null;
  if (!customerId || !(await repo.customerExists(customerId))) return { ok: false, code: "customer", msg: "Customer not found." };
  const plan = planId ? await repo.findPlanById(planId) : null;
  if (v.planId && !plan) return { ok: false, code: "plan", msg: "Plan not found." };
  if (plan && plan.liveCourseId !== liveCourseId) return { ok: false, code: "mismatch", msg: "Plan does not belong to this live course." };

  const now = new Date();
  let startAt = now;
  if (v.startAt) { const dt = new Date(v.startAt); if (isNaN(dt.getTime())) return { ok: false, code: "startAt", msg: "startAt must be a valid date." }; startAt = dt; }
  // plan.duration is DAYS (per the live-course controllers' computeEndAt asDays).
  let endAt: Date;
  if (v.endAt) { const dt = new Date(v.endAt); if (isNaN(dt.getTime())) return { ok: false, code: "endAt", msg: "endAt must be a valid date." }; endAt = dt; }
  else if (v.durationDays != null) endAt = computeEndAt({ startAt, durationMonths: v.durationDays, asDays: true });
  else if (v.durationMonths != null) endAt = computeEndAt({ startAt, durationMonths: v.durationMonths });
  else if (plan) endAt = computeEndAt({ startAt, durationMonths: plan.duration, asDays: true });
  else return { ok: false, code: "duration", msg: "durationDays is required (or supply planId)." };
  if (endAt.getTime() <= startAt.getTime()) return { ok: false, code: "window", msg: "endAt must be after startAt." };

  // Subscription Type = Extend: top up the customer's existing active subscription
  // for this live course. The payment is still recorded (an extend is a paid txn),
  // so the method + reference ids + paid amount are written onto the row too.
  const existing = v.extend === true ? await repo.findActiveSubscription(customerId, liveCourseId, now) : null;
  if (existing) {
    const newEnd = v.durationDays != null
      ? extendEndAt({ currentEndAt: existing.endAt, durationMonths: v.durationDays, asDays: true, now })
      : v.durationMonths != null
        ? extendEndAt({ currentEndAt: existing.endAt, durationMonths: v.durationMonths, now })
        : plan
          ? extendEndAt({ currentEndAt: existing.endAt, durationMonths: plan.duration, asDays: true, now })
          : endAt;
    const updated = await repo.updateSubscription(existing.id, {
      endAt: newEnd,
      planId,
      paidAt: now,
      paidAmount: v.amount ?? existing.paidAmount ?? 0,
      paymentMethod: v.paymentMethod ?? "cash",
      razorpayOrderId: v.razorpayOrderId ?? null,
      razorpayPaymentId: v.razorpayPaymentId ?? null,
      bankTransactionId: v.bankTransactionId ?? null,
      ...(v.remarks !== undefined ? { remarks: v.remarks } : {}),
      // Extend = admin edit of an existing row → stamp updated_by only.
      ...(v.actingAdminId != null ? { updated_by: v.actingAdminId } : {}),
    });
    return { ok: true, created: false, data: (await hydrateSubs([updated]))[0] };
  }
  // Standardized payment section: amount → paid_amount; granular method +
  // reference ids persist inline (no sibling order table for live courses).
  const shippingId = v.customerShippingId != null ? parseLiveId(v.customerShippingId) : null;
  const sub = await repo.createSubscription({
    customerId, liveCourseId, planId, startAt, endAt, status: true,
    paidAmount: v.amount ?? 0,
    paymentStatus: "verified",
    paymentMethod: v.paymentMethod ?? "cash",
    razorpayOrderId: v.razorpayOrderId ?? null,
    razorpayPaymentId: v.razorpayPaymentId ?? null,
    bankTransactionId: v.bankTransactionId ?? null,
    withMaterial: !!v.withMaterial,
    customerShippingId: shippingId,
    remarks: v.remarks ?? null,
    paidAt: now,
    // Admin-initiated manual grant → both audit columns = the acting admin.
    created_by: v.actingAdminId ?? null,
    updated_by: v.actingAdminId ?? null,
    createdAt: now, updatedAt: now,
  });
  return { ok: true, created: true, data: (await hydrateSubs([sub]))[0] };
};

export const updateSubscription = async (id: number, v: { status?: boolean; paymentStatus?: string; startAt?: string; endAt?: string; actingAdminId?: number | null }): Promise<"not_found" | "bad_start" | "bad_end" | any> => {
  if (!(await repo.findSubscriptionById(id))) return "not_found";
  const data: any = { updatedAt: new Date() };
  // Admin edit → stamp updated_by (created_by untouched).
  if (v.actingAdminId != null) data.updated_by = v.actingAdminId;
  if (v.status !== undefined) data.status = v.status;
  if (v.paymentStatus !== undefined) data.paymentStatus = v.paymentStatus;
  if (v.startAt !== undefined) { const dt = new Date(v.startAt); if (isNaN(dt.getTime())) return "bad_start"; data.startAt = dt; }
  if (v.endAt !== undefined) { const dt = new Date(v.endAt); if (isNaN(dt.getTime())) return "bad_end"; data.endAt = dt; }
  const updated = await repo.updateSubscription(id, data);
  return (await hydrateSubs([updated]))[0];
};

export const deleteSubscription = async (id: number): Promise<boolean> => {
  if (!(await repo.findSubscriptionById(id))) return false;
  await repo.deleteSubscription(id);
  return true;
};

// ── schedule folders / entries (JSON on ws_live_course; synthetic ids) ──────────
const MAX_FOLDERS = 50, MAX_ENTRIES = 500;
const sortByOrder = (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0);
const projectFolder = (f: any) => ({ _id: f._id, title: f.title, image: f.image ?? null, order: f.order ?? 0, status: f.status !== false, entries: [...(f.entries ?? [])].sort(sortByOrder) });

const loadFolders = async (id: number): Promise<"not_found" | { row: LiveCourse; folders: any[] }> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";
  return { row, folders: jArr(row.scheduleFolders) };
};

export const listScheduleFolders = async (id: number): Promise<"not_found" | { scheduleFolders: any[] }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  return { scheduleFolders: [...r.folders].sort(sortByOrder).map(projectFolder) };
};

export const createScheduleFolder = async (id: number, input: { title: string; image?: string | null; order?: number; status?: boolean }): Promise<"not_found" | "max" | { scheduleFolder: any }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  if (r.folders.length >= MAX_FOLDERS) return "max";
  const folder = { _id: synthId("f"), title: input.title, image: input.image ?? null, order: typeof input.order === "number" ? input.order : r.folders.length, status: input.status ?? true, entries: [] };
  const next = [...r.folders, folder];
  await repo.setSchedule(id, "scheduleFolders", next);
  return { scheduleFolder: projectFolder(folder) };
};

export const updateScheduleFolder = async (id: number, folderId: string, patch: any): Promise<"not_found" | "folder_not_found" | { scheduleFolder: any }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  const folder = r.folders.find((f) => String(f._id) === folderId);
  if (!folder) return "folder_not_found";
  for (const k of ["title", "image", "order", "status"]) if (patch[k] !== undefined) folder[k] = patch[k];
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { scheduleFolder: projectFolder(folder) };
};

export const deleteScheduleFolder = async (id: number, folderId: string): Promise<"not_found" | "folder_not_found" | true> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  if (!r.folders.some((f) => String(f._id) === folderId)) return "folder_not_found";
  await repo.setSchedule(id, "scheduleFolders", r.folders.filter((f) => String(f._id) !== folderId));
  return true;
};

export const reorderScheduleFolders = async (id: number, folderIds: string[]): Promise<"not_found" | "mismatch" | { scheduleFolders: any[] }> => {
  const r = await loadFolders(id);
  if (r === "not_found") return r;
  const have = new Set(r.folders.map((f) => String(f._id)));
  if (folderIds.length !== r.folders.length || folderIds.some((x) => !have.has(String(x)))) return "mismatch";
  folderIds.forEach((fid, idx) => { const f = r.folders.find((x) => String(x._id) === String(fid)); if (f) f.order = idx; });
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { scheduleFolders: [...r.folders].sort(sortByOrder).map(projectFolder) };
};

const loadFolder = async (id: number, folderId: string) => {
  const r = await loadFolders(id);
  if (r === "not_found") return "not_found" as const;
  const folder = r.folders.find((f) => String(f._id) === folderId);
  if (!folder) return "folder_not_found" as const;
  return { row: r.row, folders: r.folders, folder };
};

// Schedule entries live in the live-course JSON column (not a table), so pagination
// is an in-memory slice of the order-sorted array; `total` is the full count.
export const listScheduleEntries = async (
  id: number, folderId: string, opts?: { skip?: number; take?: number }
): Promise<"not_found" | "folder_not_found" | { data: any[]; total: number }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  const sorted = [...(r.folder.entries ?? [])].sort(sortByOrder);
  const paginate = opts != null && (opts.skip != null || opts.take != null);
  const data = paginate ? sorted.slice(opts!.skip ?? 0, (opts!.skip ?? 0) + (opts!.take ?? sorted.length)) : sorted;
  return { data, total: sorted.length };
};

export const createScheduleEntry = async (id: number, folderId: string, input: { date: Date; subject: string; time: string; order?: number }): Promise<"not_found" | "folder_not_found" | "max" | { entry: any }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  if ((r.folder.entries?.length ?? 0) >= MAX_ENTRIES) return "max";
  const entry = { _id: synthId("e"), date: input.date, subject: input.subject, time: input.time, order: typeof input.order === "number" ? input.order : (r.folder.entries?.length ?? 0) };
  r.folder.entries = [...(r.folder.entries ?? []), entry];
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { entry };
};

export const updateScheduleEntry = async (id: number, folderId: string, entryId: string, patch: any): Promise<"not_found" | "folder_not_found" | "entry_not_found" | { entry: any }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  const entry = (r.folder.entries ?? []).find((e: any) => String(e._id) === entryId);
  if (!entry) return "entry_not_found";
  for (const k of ["date", "subject", "time", "order"]) if (patch[k] !== undefined) entry[k] = patch[k];
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { entry };
};

export const deleteScheduleEntry = async (id: number, folderId: string, entryId: string): Promise<"not_found" | "folder_not_found" | "entry_not_found" | true> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  if (!(r.folder.entries ?? []).some((e: any) => String(e._id) === entryId)) return "entry_not_found";
  r.folder.entries = (r.folder.entries ?? []).filter((e: any) => String(e._id) !== entryId);
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return true;
};

export const reorderScheduleEntries = async (id: number, folderId: string, entryIds: string[]): Promise<"not_found" | "folder_not_found" | "mismatch" | { entries: any[] }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  const entries = r.folder.entries ?? [];
  const have = new Set(entries.map((e: any) => String(e._id)));
  if (entryIds.length !== entries.length || entryIds.some((x) => !have.has(String(x)))) return "mismatch";
  entryIds.forEach((eid, idx) => { const e = entries.find((x: any) => String(x._id) === String(eid)); if (e) e.order = idx; });
  await repo.setSchedule(id, "scheduleFolders", r.folders);
  return { entries: [...entries].sort(sortByOrder) };
};

// ════════════════════════════════════════════════════════════════════════════
// Reminders / Chat / Polls (client + admin live surfaces)
// ════════════════════════════════════════════════════════════════════════════

// ── reminders: READ only on SQL ─────────────────────────────────────────────
// The set/remove WRITE path provisions Mongo Notification rows + BullMQ jobs, so
// it stays on Mongo (the notification pipeline isn't migrated). Reads are SQL.
const toReminderDto = (r: any, session?: any) => ({
  id: String(r.id),
  liveSessionId: idStrOrNull(r.liveSessionId),
  liveCourseId: idStrOrNull(r.liveCourseId),
  minutesBefore: r.minutesBefore,
  remindAt: r.remindAt ?? null,
  sessionScheduledAt: r.sessionScheduledAt ?? null,
  status: r.status ?? null,
  ...(session ? { session: { _id: String(session.id), title: session.title ?? null, scheduledAt: session.scheduledAt ?? null, status: session.status, subject: session.subject ?? "", streamId: session.streamId ?? null } } : {}),
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export const listRemindersForCustomer = async (customerId: number) => {
  const rows = await repo.remindersForCustomer(customerId);
  const sessions = new Map((await repo.sessionsByIds([...new Set(rows.map((r) => r.liveSessionId).filter((x): x is number => x != null))])).map((s) => [s.id, s]));
  return rows.map((r) => toReminderDto(r, r.liveSessionId != null ? sessions.get(r.liveSessionId) : undefined));
};

export const getReminderForSession = async (customerId: number, liveSessionId: number) => {
  const r = await repo.reminderForSession(customerId, liveSessionId);
  if (!r) return null;
  const s = (await repo.sessionsByIds([liveSessionId]))[0];
  return toReminderDto(r, s);
};

// ── chat ─────────────────────────────────────────────────────────────────────
// `isAdmin` + `role` let the FE style admin/super-admin messages identically on
// history reload and on the live `new_message` event. There is no stored role
// column (ws_live_chat_message only has is_admin + admin_id), so `role` is
// resolved from the admin's current spatie roles at read time; non-admin
// (customer) rows get role: null.
const toChatMessageDto = (m: any, role: string | null = null) => ({ _id: String(m.id), customerId: idStrOrNull(m.customerId), userName: m.userName ?? null, message: m.message ?? null, isAdmin: !!m.isAdmin, role: m.isAdmin ? role : null, createdAt: m.createdAt ?? null });

export const getChatHistory = async (liveClassId: string, limit: number, before?: Date) => {
  const rows = await repo.chatHistory(liveClassId, limit, before);
  // Batch-resolve the current role for every distinct admin author on this
  // page (one pivot query, not one per message).
  const adminIds = Array.from(
    new Set(rows.filter((r: any) => r.isAdmin && r.adminId != null).map((r: any) => String(r.adminId)))
  );
  const roleByAdminId = new Map<string, string>();
  if (adminIds.length) {
    try {
      const rolesMap = await adminAuthRepository.findRolesForMany(adminIds.map((id) => BigInt(id)));
      for (const [id, roles] of rolesMap) roleByAdminId.set(id, deriveRole(roles.map((r) => r.name)));
    } catch {
      /* best-effort: fall back to a generic admin role below */
    }
  }
  const roleFor = (m: any): string | null =>
    m.isAdmin ? (m.adminId != null ? roleByAdminId.get(String(m.adminId)) ?? "admin" : "admin") : null;
  return rows.reverse().map((m: any) => toChatMessageDto(m, roleFor(m))); // chrono order (Mongo reverses too)
};

export const getChatBanStatus = async (customerId: number) => {
  const ban = await repo.chatBanForCustomer(customerId);
  return ban ? { isBanned: true, reason: ban.reason ?? null, bannedAt: ban.createdAt ?? null } : { isBanned: false, reason: null, bannedAt: null };
};

/**
 * Persist a CUSTOMER live-chat message (the socket `send_message` path).
 * Mirrors sendAdminChatMessage but writes customerId (not adminId) and
 * isAdmin:false. Returns the Mongo-ish shape the socket emits as `new_message`.
 */
export const sendCustomerChatMessage = async (input: { liveClassId: string; customerId: number | null; userName?: string | null; message: string }) => {
  const now = new Date();
  const created = await repo.createChatMessage({ liveClassId: input.liveClassId, customerId: input.customerId, adminId: null, isAdmin: false, userName: input.userName ?? "", message: input.message, createdAt: now, updatedAt: now });
  return { _id: String(created.id), liveClassId: created.liveClassId, customerId: idStrOrNull(created.customerId), userName: created.userName, message: created.message, createdAt: created.createdAt };
};

/** True iff this customer currently has a chat ban (socket send_message guard). */
export const isCustomerChatBanned = async (customerId: number): Promise<boolean> =>
  !!(await repo.chatBanForCustomer(customerId));

export const sendAdminChatMessage = async (input: { liveClassId: string; adminId: number | null; userName?: string | null; message: string }) => {
  const now = new Date();
  const created = await repo.createChatMessage({ liveClassId: input.liveClassId, customerId: null, adminId: input.adminId, isAdmin: true, userName: input.userName ?? "Admin", message: input.message, createdAt: now, updatedAt: now });
  return { _id: String(created.id), liveClassId: created.liveClassId, userName: created.userName, message: created.message, isAdmin: true, createdAt: created.createdAt };
};

export const deleteChatMessage = async (id: number, deletedBy: number | null): Promise<"not_found" | "already" | { liveClassId: string; deletedAt: Date }> => {
  const existing = await repo.findChatMessage(id);
  if (!existing) return "not_found";
  if (existing.deletedAt) return "already";
  const deletedAt = new Date();
  await repo.softDeleteChatMessage(id, deletedBy);
  return { liveClassId: existing.liveClassId, deletedAt };
};

export const listChatBans = async () => {
  const bans = await repo.listChatBans();
  const custs = new Map((await repo.customersByIds([...new Set(bans.map((b) => b.customerId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  // liveClassId is a LiveSession Streamos streamId string — resolve to a session so the panel can show which live session the ban is from.
  const sessions = new Map((await repo.sessionsByStreamIds([...new Set(bans.map((b) => b.liveClassId).filter((x): x is string => !!x && x.trim() !== ""))])).map((s) => [s.streamId, s]));
  return bans.map((b) => {
    const c = b.customerId != null ? custs.get(b.customerId) : undefined;
    const s = b.liveClassId ? sessions.get(b.liveClassId) : undefined;
    return {
      _id: String(b.id),
      liveClassId: b.liveClassId,
      customerId: idStrOrNull(b.customerId),
      customer: c ? { _id: String(c.id), fullName: c.fullName ?? null, emailAddress: c.emailAddress ?? null, phoneNumber: c.phoneNumber } : null,
      liveSession: s ? { _id: String(s.id), title: s.title ?? null, subject: s.subject ?? null, scheduledAt: s.scheduledAt ?? null, status: s.status } : null,
      reason: b.reason ?? null,
      createdAt: b.createdAt ?? null,
    };
  });
};

export const banCustomerFromChat = async (liveClassId: string, customerId: number, bannedBy: number | null, reason: string | null): Promise<"already" | any> => {
  if (await repo.chatBanForCustomer(customerId)) return "already";
  const b = await repo.banCustomer(liveClassId, customerId, bannedBy, reason);
  return { _id: String(b.id), liveClassId: b.liveClassId, customerId: String(customerId), reason: b.reason ?? null, createdAt: b.createdAt };
};

export const unbanCustomerFromChat = async (customerId: number): Promise<boolean> => {
  const r = await repo.unbanCustomer(customerId);
  return r.count > 0;
};

// ── chat settings (per liveClassId) ─────────────────────────────────────────────
export interface ChatSettings {
  chatEnabled: boolean;
  privateChat: boolean;
}

/** Defaults preserve today's behavior: chat on, public. */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { chatEnabled: true, privateChat: false };

/** Current settings for a live class — defaults when no row saved. */
export const getChatSettings = async (liveClassId: string): Promise<ChatSettings> => {
  const row = await repo.chatSettingFor(liveClassId);
  return row
    ? { chatEnabled: row.chatEnabled, privateChat: row.privateChat }
    : { ...DEFAULT_CHAT_SETTINGS };
};

/** Persist a partial settings patch (upsert); returns the FULL updated object. */
export const updateChatSettings = async (
  liveClassId: string,
  patch: { chatEnabled?: boolean; privateChat?: boolean }
): Promise<ChatSettings> => {
  const row = await repo.upsertChatSetting(liveClassId, patch);
  return { chatEnabled: row.chatEnabled, privateChat: row.privateChat };
};

// ── polls ──────────────────────────────────────────────────────────────────────
const toPollDto = (p: any, options: any[]) => ({
  _id: String(p.id),
  liveClassId: p.liveClassId,
  question: p.question,
  options: options.map((o) => ({ text: o.text, votes: o.votes })),
  totalVotes: p.totalVotes,
  isActive: p.isActive,
  createdBy: idStrOrNull(p.createdBy),
  createdByName: p.createdByName ?? null,
  closedAt: p.closedAt ?? null,
  createdAt: p.createdAt ?? null,
});

const loadPollWithOptions = async (p: any) => toPollDto(p, await repo.pollOptions(p.id));

export const getActivePoll = async (liveClassId: string, customerId: number) => {
  const poll = await repo.activePoll(liveClassId);
  if (!poll) return { poll: null, myVote: null };
  const dto = await loadPollWithOptions(poll);
  const vote = await repo.pollVoteFor(poll.id, customerId);
  return { poll: dto, myVote: vote ? vote.optionIndex : null };
};

/**
 * Record a student's vote (the socket `submit_vote` path). Validates the poll
 * exists, is active and the option index is in range, then records the vote and
 * bumps counters. Returns the FULL fresh poll DTO (`toPollDto`: _id, liveClassId,
 * question, options[{text,votes}], totalVotes, isActive, …) so the socket can
 * broadcast the complete current poll on `poll_update` and the panel re-renders
 * exact tallies in place. Discriminated string results map to the socket's
 * existing error emits. Re-voting is allowed: a customer may change their vote
 * any number of times (the vote row is moved, so each customer still counts once).
 */
export const submitPollVote = async (
  pollId: number,
  customerId: number,
  optionIndex: number
): Promise<
  | Awaited<ReturnType<typeof loadPollWithOptions>>
  | "not_found"
  | "closed"
  | "invalid_option"
> => {
  const poll = await repo.findPoll(pollId);
  if (!poll) return "not_found";
  if (!poll.isActive) return "closed";
  const options = await repo.pollOptions(pollId);
  if (optionIndex < 0 || optionIndex >= options.length) return "invalid_option";
  // Re-votable: a customer may change their vote as many times as they want. The
  // vote row is moved (still one per customer), so counts stay consistent.
  await repo.upsertPollVote(pollId, customerId, optionIndex);
  const fresh = await repo.findPoll(pollId);
  // Re-read from the fresh row so totalVotes/options reflect the vote just cast.
  return loadPollWithOptions(fresh ?? poll);
};

export const getPollsByClass = async (liveClassId: string) => {
  const polls = await repo.pollsByClass(liveClassId);
  return Promise.all(polls.map(loadPollWithOptions));
};

export const getPollResults = async (pollId: number): Promise<"not_found" | any> => {
  const poll = await repo.findPoll(pollId);
  return poll ? loadPollWithOptions(poll) : "not_found";
};

export const createPoll = async (input: { liveClassId: string; question: string; options: string[]; createdBy: number | null; createdByName?: string | null }) => {
  // Close any currently-active poll for the class first (mirror Mongo).
  const existingActive = await repo.activePoll(input.liveClassId);
  if (existingActive) await repo.closePoll(existingActive.id);
  const now = new Date();
  const created = await repo.createPollWithOptions(
    { liveClassId: input.liveClassId, question: input.question, totalVotes: 0, isActive: true, createdBy: input.createdBy, createdByName: input.createdByName ?? null, createdAt: now, updatedAt: now },
    input.options.map((text) => ({ text, votes: 0 }))
  );
  return { poll: await loadPollWithOptions(created), closedPollId: existingActive ? String(existingActive.id) : null };
};

export const updatePoll = async (pollId: number, patch: { question?: string; isActive?: boolean }): Promise<"not_found" | any> => {
  if (!(await repo.findPoll(pollId))) return "not_found";
  const data: any = { updatedAt: new Date() };
  if (patch.question !== undefined) data.question = patch.question;
  if (patch.isActive !== undefined) { data.isActive = patch.isActive; if (!patch.isActive) data.closedAt = new Date(); }
  const updated = await repo.updatePoll(pollId, data);
  return loadPollWithOptions(updated);
};

/**
 * Edit an active poll's question and/or options — only permitted while the poll
 * is active AND has zero votes (mirrors the Mongo guard). Returns discriminated
 * strings for the guard failures so the controller maps them to the exact same
 * HTTP codes/messages; otherwise returns the poll DTO with reloaded options.
 */
export const updatePollWithOptions = async (
  pollId: number,
  patch: { question?: string; options?: string[] }
): Promise<"not_found" | "closed" | "has_votes" | any> => {
  const poll = await repo.findPoll(pollId);
  if (!poll) return "not_found";
  if (!poll.isActive) return "closed";
  if (poll.totalVotes > 0) return "has_votes";
  const updated = await repo.updatePollWithOptions(pollId, {
    question: patch.question,
    options: patch.options ? patch.options.map((text) => ({ text, votes: 0 })) : undefined,
  });
  return loadPollWithOptions(updated);
};

export const closePoll = async (pollId: number): Promise<"not_found" | any> => {
  if (!(await repo.findPoll(pollId))) return "not_found";
  return loadPollWithOptions(await repo.closePoll(pollId));
};

export const deletePoll = async (pollId: number): Promise<boolean> => {
  if (!(await repo.findPoll(pollId))) return false;
  await repo.deletePoll(pollId);
  return true;
};

// ════════════════════════════════════════════════════════════════════════════
// Client live-course reads (Groups A + B) — SQL entitlement + listing/schedule
// ════════════════════════════════════════════════════════════════════════════
import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { qualitiesFromSessionRecordings } from "../../utils/videoQualities";
import { signMediaToken } from "../../utils/mediaToken";
import { formatScheduledAt } from "../../utils/displayTime";

// Streamos sometimes appends stray quote chars to recording paths — strip them
// (mirrors sanitizeRecordingPath in client/live-course.controller).
const sanitizeRecPath = <T extends string | null | undefined>(p: T): T =>
  (typeof p === "string" ? (p.replace(/(?:"|%22|%2522)+$/i, "") as T) : p);

// Pick the single best (highest-resolution) MP4 url from a per-quality list, for
// the convenience `mp4Url` field. Falls back to the first entry, or null when none.
const pickBestMp4 = (recs: Array<{ quality: string | null; path: string }>): string | null => {
  if (!recs.length) return null;
  const heightOf = (q: string | null) => Number(String(q ?? "").match(/(\d+)/)?.[1] ?? 0);
  return [...recs].sort((a, b) => heightOf(b.quality) - heightOf(a.quality))[0]?.path ?? recs[0].path ?? null;
};

// ── entitlement (ported from src/client/live-course/entitlement.ts; SQL) ──────
export const hasAccessToAnyLiveCourse = async (customerId: number | null, liveCourseIds: number[]): Promise<boolean> => {
  if (!customerId || !liveCourseIds.length) return false;
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, new Date());
  return subs.length > 0;
};

/**
 * Which of `liveCourseIds` actually grants access — the same active+verified
 * check as hasAccessToAnyLiveCourse, but it reports the WINNER so the client can
 * be told `accessGrantedByLiveCourseId`. Resolves in the caller's id order so a
 * course-scoped call (single id) and a Live Now call (all linked ids, in link
 * order) both give a stable, explainable answer. `null` = no entitlement.
 */
export const firstEntitledLiveCourseId = async (
  customerId: number | null,
  liveCourseIds: number[]
): Promise<number | null> => {
  if (!customerId || !liveCourseIds.length) return null;
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, new Date());
  if (!subs.length) return null;
  const entitled = new Set(subs.map((s) => s.liveCourseId));
  return liveCourseIds.find((id) => entitled.has(id)) ?? null;
};

export const getDaysLeftMap = async (customerId: number | null, liveCourseIds: number[]): Promise<Map<string, number | null>> => {
  const out = new Map<string, number | null>();
  if (!customerId || !liveCourseIds.length) return out;
  const now = new Date();
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, now);
  const lifetime = new Set<string>();
  const latest = new Map<string, Date>();
  for (const s of subs) {
    const key = String(s.liveCourseId);
    if (s.endAt == null) { lifetime.add(key); continue; }
    const prev = latest.get(key);
    if (!prev || s.endAt.getTime() > prev.getTime()) latest.set(key, s.endAt);
  }
  for (const k of lifetime) out.set(k, null);
  for (const [k, end] of latest) if (!lifetime.has(k)) out.set(k, computeDaysLeft(end, now));
  return out;
};

export const getOwnedCourseIds = async (customerId: number | null): Promise<Set<string>> => {
  if (!customerId) return new Set();
  return new Set((await repo.ownedCourseIds(customerId, new Date())).map(String));
};

export const getPurchaseCounts = async (liveCourseIds: number[]): Promise<Map<string, number>> => {
  const m = await repo.purchaseCounts(liveCourseIds);
  return new Map([...m].map(([k, v]) => [String(k), v]));
};

// plan DTO with originalPrice/discountPercent enrichment (matches client listing).
const toClientPlan = (p: LiveCoursePlan) => {
  const original = p.originalPrice != null && p.originalPrice > p.price ? p.originalPrice : null;
  return {
    _id: String(p.id), liveCourseId: String(p.liveCourseId), name: p.name ?? null, duration: p.duration,
    price: p.price, originalPrice: original, discountPercent: original ? Math.round(((original - p.price) / original) * 100) : 0,
    withMaterial: p.withMaterial ?? false, materialPrice: p.materialPrice ?? null,
    isDefault: p.isDefault, status: p.status,
    isMostPopular: (p as any).isMostPopular ?? false,
  };
};

// ⚠ packageCategoryId is surfaced as the bare id (no Mongo populate — no SQL
// ws_package_category table). courseEducatorId likewise bare id.
export const plansGrouped = async (courseIds: number[]) => {
  const plans = await repo.activePlansForCourses(courseIds);
  const byCourse = new Map<number, any[]>();
  for (const p of plans) { const a = byCourse.get(p.liveCourseId) ?? []; a.push(toClientPlan(p)); byCourse.set(p.liveCourseId, a); }
  return byCourse;
};

// Split a course's flat plan list into the { withMaterial, withoutMaterial }
// shape the client/courses detail + live-course detail endpoints use, so the
// live-course listing matches that contract.
export const splitPlansByMaterial = (arr: any[]) => ({
  withMaterial: arr.filter((p) => p.withMaterial),
  withoutMaterial: arr.filter((p) => !p.withMaterial),
});

// ── getLiveCourseForClient (detail) — SQL ────────────────────────────────────
// Mongo populates courseEducatorId (name/image/about) + packageCategoryId
// (title/slug/image) — both tables exist in SQL so we populate them too.
// subjectsCount = schedule folders under the course (JSON); materialsCount has no
// SQL home on ws_live_course → 0 (documented drift). Playback URLs never here.
export const getLiveCourseDetailForClient = async (
  id: number,
  customerId: number | null,
  baseUrl?: string
): Promise<"not_found" | any> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";

  const [educator, pkgCat, plansRaw, subscribed, daysLeftMap] = await Promise.all([
    row.educatorId != null ? repo.findEducator(row.educatorId) : Promise.resolve(null),
    row.packageCategoryId != null ? repo.findPackageCategory(row.packageCategoryId) : Promise.resolve(null),
    repo.listPlans(id),
    hasAccessToAnyLiveCourse(customerId, [id]),
    getDaysLeftMap(customerId, [id]),
  ]);

  // Deactivated live course stays hidden from non-owners (browse/purchase), but existing
  // active subscribers keep full access to its detail + content.
  if (!row.status && !subscribed) return "not_found";

  const planList = plansRaw
    .filter((p) => p.status)
    .sort((a, b) => a.price - b.price)
    .map((p) => toClientPlan(p));
  // Split by material variant — mirrors the package detail contract
  // (catalog-package.detail.sql.ts): plans: { withMaterial, withoutMaterial }.
  const plans = {
    withMaterial: planList.filter((p) => p.withMaterial),
    withoutMaterial: planList.filter((p) => !p.withMaterial),
  };

  const shareableLink = buildShareUrl("live-courses", String(id), baseUrl);
  const folders = jArr(row.scheduleFolders);
  const stats = { subjectsCount: folders.length, materialsCount: 0, classType: row.classType ?? "live" };
  const liveCourse = {
    ...toCourseDto(row),
    courseEducatorId: educator
      ? { _id: String(educator.id), name: educator.name, image: educator.image, about: educator.about }
      : null,
    packageCategoryId: pkgCat
      ? { _id: String(pkgCat.id), title: pkgCat.title, slug: pkgCat.slug, image: pkgCat.image }
      : null,
    isPaid: row.isPaid,
    shareableLink,
  };
  const daysLeft = daysLeftMap.has(String(id)) ? daysLeftMap.get(String(id)) ?? null : null;
  return { liveCourse, scope: { kind: "liveCourse", id: String(id) }, stats, plans, subscribed, isPaid: row.isPaid, isPurchased: subscribed, daysLeft, shareableLink };
};

// ── listMyLiveCourses — SQL ──────────────────────────────────────────────────
export const listMyLiveCoursesForClient = async (
  customerId: number,
  filterStatus: string,
  baseUrl?: string,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
) => {
  const now = new Date();
  const subs = await repo.myLiveCourseSubs(customerId, filterStatus, now);
  const courseIds = [...new Set(subs.map((s) => s.liveCourseId).filter((n): n is number => n != null))];
  const planIds = [...new Set(subs.map((s) => s.planId).filter((n): n is number => n != null))];
  const [courses, plans] = await Promise.all([
    courseIds.length ? repo.coursesSlimByIds(courseIds) : Promise.resolve([]),
    planIds.length ? repo.plansByIds(planIds) : Promise.resolve([]),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  // Educator names for the "By <educator>" card subtitle.
  const eduIds = [...new Set(courses.map((c) => c.educatorId).filter((n): n is number => n != null))];
  const educators = eduIds.length
    ? await prisma.courseEducator.findMany({ where: { id: { in: eduIds } }, select: { id: true, name: true, image: true } })
    : [];
  const eduById = new Map(educators.map((e) => [e.id, e]));

  // Per-course progress for the card's bar / "X of Y sessions completed" label.
  // A "session" here = a recorded lecture (the unit progress heartbeats actually
  // drive), so numerator and denominator share one universe and the ratio stays
  // sane (<=100%). total = active videos under the course's folders (same folder->
  // video counting as getRecordingsForClient's totalLectures); completed = the
  // customer's completed VIDEO lectures in that live-course container.
  const totalByCourse = new Map<number, number>();
  const doneByCourse = new Map<number, number>();
  await Promise.all(courseIds.map(async (id) => {
    const folders = await prisma.videoCategory.findMany({ where: { liveCourseId: id, status: true }, select: { id: true } });
    const folderIds = folders.map((f) => f.id);
    const [total, done] = await Promise.all([
      folderIds.length ? prisma.video.count({ where: { status: true, videoCategoryId: { in: folderIds } } }) : Promise.resolve(0),
      prisma.lectureProgress.count({ where: { customerId, liveCourseId: id, completed: true, videoId: { not: null } } }),
    ]);
    totalByCourse.set(id, total);
    doneByCourse.set(id, done);
  }));

  const liveCourses = subs.map((s) => {
    const active = s.status === true && (s.endAt == null || new Date(s.endAt).getTime() >= now.getTime());
    const c = s.liveCourseId != null ? courseById.get(s.liveCourseId) : null;
    const p = s.planId != null ? planById.get(s.planId) : null;
    const edu = c?.educatorId != null ? eduById.get(c.educatorId) ?? null : null;
    const totalSessions = c ? totalByCourse.get(c.id) ?? 0 : 0;
    const completedSessions = c ? doneByCourse.get(c.id) ?? 0 : 0;
    return {
      subscriptionId: String(s.id),
      liveCourse: c
        ? {
            _id: String(c.id), name: c.name, image: c.image, isPaid: c.isPaid, status: c.status,
            educatorId: edu ? String(edu.id) : null,
            educatorName: edu?.name ?? null,
            shareableLink: buildShareUrl("live-courses", String(c.id), baseUrl),
          }
        : null,
      plan: p ? { _id: String(p.id), name: p.name, duration: p.duration, price: p.price } : null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      paymentStatus: s.paymentStatus,
      active,
      daysLeft: active ? computeDaysLeft(s.endAt ?? null, now) : 0,
      progress: {
        completedSessions,
        totalSessions,
        percentCompleted: totalSessions > 0 ? Math.min(100, Math.round((completedSessions / totalSessions) * 100)) : 0,
      },
    };
  });
  // Optional name search + pagination over the resolved cards (subscription rows
  // are hydrated in-memory, so paginate the assembled array via slice).
  const filtered = q.search
    ? liveCourses.filter((c) => matchesAllTokens(q.search, [c.liveCourse?.name]))
    : liveCourses;
  const total = filtered.length;
  const paged = filtered.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);
  return { liveCourses: paged, total, page: q.page, limit: q.limit };
};

// ── purchase options (ported from entitlement.buildPurchaseOptions; SQL) ──────
export const buildPurchaseOptionsSql = async (courseIds: number[]) => {
  if (!courseIds.length) return [];
  const [courses, plans] = await Promise.all([
    prisma.liveCourse.findMany({ where: { id: { in: courseIds }, status: true }, select: { id: true, name: true, image: true } }),
    prisma.liveCoursePlan.findMany({ where: { liveCourseId: { in: courseIds }, status: true }, orderBy: { price: "asc" } }),
  ]);
  const byCourse = new Map<number, any[]>();
  for (const p of plans) { const a = byCourse.get(p.liveCourseId) ?? []; a.push(p); byCourse.set(p.liveCourseId, a); }
  return courses.map((c) => ({
    liveCourseId: String(c.id), name: c.name, image: c.image,
    plans: (byCourse.get(c.id) ?? []).map((p) => ({ planId: String(p.id), name: p.name ?? null, duration: p.duration, price: p.price, isDefault: p.isDefault })),
  }));
};

// ── listLiveCourseRecordings (folders + lectures + per-quality) — SQL ──────────
// Recordings are immutable once StreamOS finishes producing them, so a longish
// cache is safe; capped so a re-processed/late recording is picked up within the hour.
const VOD_META_CACHE_TTL_SEC = 3600;

type VodRec = { quality: string | null; file_size: number | null; path: string };
interface CachedVodMeta {
  hlsUrl: string | null;
  hls: VodRec[];
  mp4: VodRec[];
}

/**
 * Resolve a session's StreamOS recording (VOD) into playable URLs via
 * get-vod-stream-meta, Redis-cached per streamId. Returns null on ANY failure so
 * the caller falls back to the stored webhook recordings — the accessKey never
 * leaves the server; only the resolved CDN URLs reach the client.
 */
const resolveVodMeta = async (streamId: string): Promise<CachedVodMeta | null> => {
  const cacheKey = `vodmeta:${streamId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached) as CachedVodMeta;
  } catch {
    /* cache read best-effort */
  }
  try {
    const meta = await getVodStreamMeta(streamId);
    const norm = (r: { quality: string; path: string }): VodRec => ({
      quality: r.quality || null,
      file_size: null,
      path: sanitizeRecPath(r.path),
    });
    const out: CachedVodMeta = { hlsUrl: meta.hlsUrl ?? null, hls: meta.hls.map(norm), mp4: meta.mp4.map(norm) };
    // Only cache a non-empty resolution so a transient blip doesn't get pinned.
    if (out.hlsUrl || out.hls.length || out.mp4.length) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(out), "EX", VOD_META_CACHE_TTL_SEC);
      } catch {
        /* cache write best-effort */
      }
    }
    return out;
  } catch {
    return null;
  }
};

export const getRecordingsForClient = async (
  courseId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
): Promise<"not_found" | any> => {
  const course = await repo.findById(courseId);
  if (!course) return "not_found";
  // Owner-aware: a deactivated live course still serves its recordings to existing active
  // subscribers, but 404s for everyone else (non-owner / browse).
  const subscribed = await hasAccessToAnyLiveCourse(customerId, [courseId]);
  if (!course.status && !subscribed) return "not_found";

  const folders = await prisma.videoCategory.findMany({
    where: { liveCourseId: courseId, status: true },
    orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    select: { id: true, title: true, image: true, order_by: true },
  });
  const folderIds = folders.map((f) => f.id);
  const videos = folderIds.length
    ? await prisma.video.findMany({ where: { videoCategoryId: { in: folderIds }, status: true }, orderBy: [{ order: "asc" }, { created_at: "asc" }] })
    : [];

  const daysLeftMap = await getDaysLeftMap(customerId, [courseId]);
  const daysLeft = daysLeftMap.has(String(courseId)) ? daysLeftMap.get(String(courseId)) ?? null : null;

  // per-quality recordings from the source live session
  const sessionIds = [...new Set(videos.map((v) => v.liveSessionId).filter((n): n is number => n != null))];
  type RecEntry = { quality: string | null; file_size: number | null; path: string };
  const recBySession = new Map<number, RecEntry[]>();
  const mp4BySession = new Map<number, RecEntry[]>();
  // VOD-meta-resolved playable URLs per session (get-vod-stream-meta, cached).
  const vodBySession = new Map<number, CachedVodMeta | null>();
  const shapeRecs = (raw: unknown): RecEntry[] =>
    (Array.isArray(raw) ? raw : [])
      .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
      .map((r: any) => ({
        quality: typeof r.quality === "string" ? r.quality : null,
        file_size: typeof r.file_size === "number" ? r.file_size : null,
        path: sanitizeRecPath(r.path),
      }));
  if (sessionIds.length) {
    const sessions = await prisma.liveSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, streamId: true, recordings: true, mp4Recordings: true } });
    for (const s of sessions) {
      recBySession.set(s.id, shapeRecs(s.recordings));
      mp4BySession.set(s.id, shapeRecs(s.mp4Recordings));
    }
    // Resolve the actually-playable URLs for each session's recording via
    // StreamOS get-vod-stream-meta (cached). Failure-isolated per session — a
    // session that can't resolve falls back to its stored webhook recordings.
    await Promise.all(
      sessions
        .filter((s) => !!s.streamId)
        .map(async (s) => {
          vodBySession.set(s.id, await resolveVodMeta(String(s.streamId)));
        })
    );
  }

  // per-video resume progress
  const progByVideo = new Map<number, any>();
  if (customerId && videos.length) {
    const rows = await prisma.lectureProgress.findMany({
      where: { customerId, videoId: { in: videos.map((v) => v.id) } },
      select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
    });
    for (const r of rows) if (r.videoId != null) progByVideo.set(r.videoId, r);
  }

  const byFolder = new Map<number, typeof videos>();
  for (const v of videos) { const a = byFolder.get(v.videoCategoryId as number) ?? []; a.push(v); byFolder.set(v.videoCategoryId as number, a); }

  const shapeLecture = (v: (typeof videos)[number]) => {
    const canPlay = subscribed || v.priceType === "free";
    const p = progByVideo.get(v.id);
    // Keep only the CLEARTEXT metadata the list screen needs (qualities picker,
    // preferred stream hint). No playable URL / source id is emitted — the client
    // exchanges `mediaToken` at /media/resolve for the real (short-lived) URLs.
    const vod = v.liveSessionId ? vodBySession.get(v.liveSessionId) ?? null : null;
    const storedHls = v.liveSessionId ? recBySession.get(v.liveSessionId) ?? [] : [];
    const hlsList = vod?.hls?.length ? vod.hls : storedHls;
    const hasHls = !!(vod?.hlsUrl || hlsList.length);
    // Locked (unpurchased paid) → no token at all. Free → free token; purchased →
    // scoped to the live course so resolve can re-check entitlement.
    const mediaToken =
      !canPlay || customerId == null
        ? null
        : v.priceType === "free"
        ? signMediaToken({ k: "liveRecording", id: v.id, free: true, cust: customerId })
        : signMediaToken({ k: "liveRecording", id: v.id, scope: { kind: "liveCourse", id: courseId }, cust: customerId });
    return {
      _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, order: v.order,
      locked: !canPlay,
      preferredStream: (hasHls ? "hls" : "mp4") as "hls" | "mp4",
      qualities: qualitiesFromSessionRecordings(hlsList),
      mediaToken,
      progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
    };
  };

  const allFolders = folders.map((f) => ({
    folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
    lectures: (byFolder.get(f.id) ?? []).map(shapeLecture),
  }));

  // Optional lecture-title search drops non-matching lectures (and now-empty
  // folders); pagination is over the FOLDER list (the recordings screen renders
  // folder-by-folder). totalLectures reflects the search-filtered universe.
  const filteredFolders = q.search
    ? allFolders
        .map((f) => ({ ...f, lectures: f.lectures.filter((l) => matchesAllTokens(q.search, [l.title])) }))
        .filter((f) => f.lectures.length > 0)
    : allFolders;
  const totalLectures = filteredFolders.reduce((n, f) => n + f.lectures.length, 0);
  const totalFolders = filteredFolders.length;
  const folderPayload = filteredFolders.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    subscribed, daysLeft, totalLectures, folders: folderPayload,
    total: totalFolders, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

// ── getLiveCourseLecture: ownership check (controller does encryptLecture) ─────
export const clientLectureVideoInCourse = async (
  courseId: number,
  videoId: number
): Promise<"video_not_found" | "mismatch" | { _id: number; platform: string; youtube_id: string | null; aws_id: string | null; vimeo_id: string | null; title: string; topic: string; priceType: "free" | "paid" }> => {
  const v = await prisma.video.findFirst({ where: { id: videoId, status: true } });
  if (!v) return "video_not_found";
  const folder = await prisma.videoCategory.findFirst({ where: { id: v.videoCategoryId ?? -1, liveCourseId: courseId }, select: { id: true } });
  if (!folder) return "mismatch";
  return { _id: v.id, platform: v.platform, youtube_id: v.youtube_id ?? null, aws_id: v.aws_id ?? null, vimeo_id: v.vimeo_id ?? null, title: v.title ?? "", topic: v.topic ?? "", priceType: v.priceType };
};

export const isLectureEntitled = async (courseId: number, customerId: number | null, priceType: "free" | "paid"): Promise<boolean> =>
  priceType === "free" ? true : hasAccessToAnyLiveCourse(customerId, [courseId]);

// ── listLiveCourseSessionRecordings — SQL (SCHEDULED/CREATED sessions) ─────────
export const listSessionRecordingsForClient = async (
  courseId: number,
  customerId: number | null,
  page: number,
  limit: number,
  search?: string
): Promise<"not_found" | { liveCourse: any; subscribed: boolean; total: number; page: number; limit: number; lectures: any[] }> => {
  const course = await repo.findById(courseId);
  if (!course) return "not_found";
  // Owner-aware: deactivated live course still serves its session recordings to existing
  // active subscribers; 404 for non-owners / browse.
  if (!course.status && !(await hasAccessToAnyLiveCourse(customerId, [courseId]))) return "not_found";

  const links = await prisma.liveSessionCourse.findMany({ where: { liveCourseId: courseId }, select: { liveSessionId: true } });
  const sessionIds = [...new Set(links.map((l) => l.liveSessionId).filter((n): n is number => n != null))];
  const where: Prisma.LiveSessionWhereInput = { id: { in: sessionIds.length ? sessionIds : [-1] }, status: { in: ["SCHEDULED", "CREATED"] }, ...(buildPrismaSearch(search, ["title"]) ?? {}) };
  const [sessions, total, subscribed] = await Promise.all([
    prisma.liveSession.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }], skip: (page - 1) * limit, take: limit }),
    prisma.liveSession.count({ where }),
    hasAccessToAnyLiveCourse(customerId, [courseId]),
  ]);

  const lectures = sessions.map((s) => ({
    sessionId: String(s.id), title: s.title, status: s.status, isLive: s.status === "CREATED" && !!s.hlsUrl,
    subject: s.subject ?? null, streamId: s.streamId ?? null, scheduledAt: s.scheduledAt ?? null,
    scheduledAtDisplay: formatScheduledAt(s.scheduledAt), endAt: s.endAt ?? null, locked: !subscribed,
  }));
  return { liveCourse: { _id: String(course.id), name: course.name, image: course.image }, subscribed, total, page, limit, lectures };
};

// ── live-session preview/trial (ported from entitlement.resolveLivePreviewState; SQL) ──
// Live-session preview/trial window length, in seconds. Relocated here from the
// retired Mongo client/live-course/entitlement.ts (was `PREVIEW_SECONDS`).
export const PREVIEW_SECONDS = 180;
const LIVE_PREVIEW_SECONDS = PREVIEW_SECONDS;

/**
 * How often the app is asked to heartbeat while playback is active. Published to
 * the client in the join response so the interval is a server decision, not a
 * hardcoded app constant that would need a release to change.
 */
export const PREVIEW_HEARTBEAT_SECONDS = 10;

/**
 * The staleness ceiling, and the single most important number here: **the most
 * watch time one heartbeat may ever charge.**
 *
 * Consumption is charged as (now − last_heartbeat_at) whenever a heartbeat lands,
 * so if the app dies mid-window and never calls /preview/stop, the cursor sits
 * frozen at the last heartbeat. Without a cap, coming back an hour later would
 * bill the entire hour. Capping the charge at one missed interval plus slack
 * means an abandoned window costs at most this many seconds — which is exactly
 * the "BE must automatically stop an active tracking window when heartbeats
 * become stale" requirement, implemented without needing a sweeper job: the
 * window self-limits instead of being closed on a timer.
 *
 * Must stay > PREVIEW_HEARTBEAT_SECONDS or ordinary jitter would under-charge
 * every single tick.
 */
export const PREVIEW_STALE_SECONDS = 20;

export type LivePreviewStateSql = {
  accessLevel: "full" | "preview" | "preview_ended";
  previewSecondsRemaining: number;
  /** The linked course that granted `full` (null on preview/preview_ended). */
  accessGrantedByLiveCourseId: number | null;
};

/**
 * Watch time owed by a still-open window but not yet committed to
 * `consumed_seconds`.
 *
 * A read (join, /media/resolve, the list feed) must include this or a client that
 * heartbeats and immediately re-joins would see its remaining time snap back up
 * by up to one interval. It is capped by PREVIEW_STALE_SECONDS exactly as the
 * heartbeat's own charge is, so a read and the heartbeat that follows it agree,
 * and an abandoned window stops growing rather than draining the trial.
 *
 * Reads stay READ-ONLY — this is computed, never persisted. Only a heartbeat or a
 * stop may advance `consumed_seconds`.
 */
const pendingPreviewCharge = (lastHeartbeatAt: Date | null | undefined, now: Date): number => {
  if (!lastHeartbeatAt) return 0; // window closed → nothing accruing
  const elapsed = Math.floor((now.getTime() - lastHeartbeatAt.getTime()) / 1000);
  return Math.max(0, Math.min(PREVIEW_STALE_SECONDS, elapsed));
};

/** Remaining trial for a row, including any uncommitted open-window time. */
const previewRemainingFrom = (
  consumedSeconds: number,
  lastHeartbeatAt: Date | null | undefined,
  now: Date
): number => {
  const consumed = Math.max(0, consumedSeconds) + pendingPreviewCharge(lastHeartbeatAt, now);
  return Math.max(0, LIVE_PREVIEW_SECONDS - Math.min(LIVE_PREVIEW_SECONDS, consumed));
};

/** The trial row for one (customer, session), oldest-wins. See the note in resolveLivePreviewStateSql. */
const oldestPreviewRow = (customerId: number, liveSessionId: number) =>
  prisma.liveSessionPreview.findFirst({ where: { customerId, liveSessionId }, orderBy: { id: "asc" } });

/**
 * Access decision for one live session, for one caller.
 *
 * `liveCourseIds` IS the entitlement scope and the caller owns that choice:
 *   - opened FROM a course → pass just `[thatCourseId]`, so owning a *different*
 *     course linked to the same shared session does NOT unlock it;
 *   - opened from Live Now (no course selected) → pass every linked course, and
 *     any active one grants full access.
 *
 * The preview (trial) row is keyed on `(customer, session)` — NOT on the course —
 * so re-entering the same shared session through another unpurchased course, a
 * new device, or a reinstall continues the SAME 180s window instead of minting a
 * fresh one.
 *
 * `track` means "the student can actually watch right now" (the session is not
 * SCHEDULED). It gates ROW CREATION only, and creation is now cheap: a new row
 * starts at `consumed_seconds = 0` with no open window, so it reserves the trial
 * without spending any of it. Consumption begins at the first heartbeat, never
 * here — READS NEVER CHARGE. That is what makes "time does not continue
 * decreasing after leaving the stream" true: with no heartbeats arriving, no
 * amount of re-joining moves the number.
 */
export const resolveLivePreviewStateSql = async (
  customerId: number | null,
  liveSessionId: number,
  liveCourseIds: number[],
  track: boolean
): Promise<LivePreviewStateSql> => {
  // A session linked to no course is gated by nothing — nothing to purchase.
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  // Full access short-circuits BEFORE any preview row is touched, so a paying
  // student never gets a tracking record.
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy };
  if (!customerId) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };

  const now = new Date();
  // Always the EARLIEST row: should a race (or a pre-unique-index duplicate) have
  // written two, the first one still bounds the window — a second concurrent
  // request can never restart the clock.
  let preview = await oldestPreviewRow(customerId, liveSessionId);

  if (!preview) {
    // Nothing watched yet. Don't create a row for a session that cannot be played
    // (SCHEDULED): report the untouched allowance read-only.
    if (!track) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    // createMany({ skipDuplicates }) → `INSERT IGNORE`, so losing the race against
    // uq_live_session_preview_customer_session is a no-op instead of a thrown
    // P2002 that Prisma's `log: ["warn","error"]` would print on every concurrent
    // open. It leans on the DB constraint rather than a schema.prisma @@unique, so
    // no Prisma client regeneration is needed and an environment where the index
    // is not applied yet still behaves correctly — it just inserts a duplicate,
    // which the oldest-row-wins read below renders harmless.
    await prisma.liveSessionPreview.createMany({
      data: [{ customerId, liveSessionId, startedAt: now, consumedSeconds: 0, lastHeartbeatAt: null, createdAt: now }],
      skipDuplicates: true,
    });
    preview = await oldestPreviewRow(customerId, liveSessionId);
    if (!preview) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
  }

  const remaining = previewRemainingFrom(preview.consumedSeconds, preview.lastHeartbeatAt, now);
  return remaining > 0
    ? { accessLevel: "preview", previewSecondsRemaining: remaining, accessGrantedByLiveCourseId: null }
    : { accessLevel: "preview_ended", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
};

// ── preview heartbeat / stop (watch-time accounting) ──────────────────────────

export type LivePreviewTickSql = LivePreviewStateSql & { previewTrackingId: string | null };

/**
 * Commit the watch time owed by an open window, then leave the window open
 * (`keepOpen`, a heartbeat) or closed (a stop / pause).
 *
 * **Why a compare-and-swap rather than a read-modify-write.** Two devices — or a
 * heartbeat racing the retry of a dropped one — can read the same cursor, both
 * compute the same charge, and both add it: the trial would drain at 2× on two
 * devices, which is precisely the "multiple concurrent heartbeats must not
 * multiply preview consumption" failure. Guarding the UPDATE on the cursor value
 * we read makes the pair atomic: exactly one writer wins, the loser observes
 * `count === 0` and re-reads WITHOUT charging. Since every writer advances the
 * one shared cursor, total consumption can never exceed the wall-clock time in
 * which at least one device was playing, no matter how many devices there are.
 *
 * A single conditional UPDATE also keeps this correct under the IST middleware —
 * it shifts `where` args and `data` args alike, so the cursor round-trips
 * consistently. Hand-written raw SQL would bypass that shift and mis-compare by
 * 5.5 hours.
 */
const commitPreviewTick = async (
  customerId: number,
  liveSessionId: number,
  keepOpen: boolean
): Promise<LivePreviewStateSql> => {
  const now = new Date();
  let preview = await oldestPreviewRow(customerId, liveSessionId);

  if (!preview) {
    // First heartbeat with no prior join (or a SCHEDULED session that never made
    // a row). Open the window charging NOTHING — there is no cursor to measure
    // from, and inventing one would bill time we never observed.
    if (!keepOpen) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    await prisma.liveSessionPreview.createMany({
      data: [{ customerId, liveSessionId, startedAt: now, consumedSeconds: 0, lastHeartbeatAt: now, createdAt: now }],
      skipDuplicates: true,
    });
    preview = await oldestPreviewRow(customerId, liveSessionId);
    if (!preview) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    // Lost the insert race: fall through and treat the winner's row as ours.
  }

  const charge = pendingPreviewCharge(preview.lastHeartbeatAt, now);
  const consumed = Math.min(LIVE_PREVIEW_SECONDS, Math.max(0, preview.consumedSeconds) + charge);
  // Once the allowance is gone the window is closed regardless of `keepOpen`:
  // there is nothing left to meter, and leaving a cursor behind would make the
  // next read compute a phantom pending charge against an already-empty trial.
  const exhausted = consumed >= LIVE_PREVIEW_SECONDS;
  const nextCursor = keepOpen && !exhausted ? now : null;

  const written = await prisma.liveSessionPreview.updateMany({
    // CAS: `lastHeartbeatAt: <value read>` compiles to `= ?` or `IS NULL`, so a
    // concurrent writer that already moved the cursor makes this match 0 rows.
    where: { id: preview.id, lastHeartbeatAt: preview.lastHeartbeatAt ?? null },
    data: { consumedSeconds: consumed, lastHeartbeatAt: nextCursor },
  });

  if (written.count === 0) {
    // Someone else committed first. Their charge covers this same interval — the
    // cursor is shared — so report their result instead of double-billing.
    const fresh = await oldestPreviewRow(customerId, liveSessionId);
    const remaining = fresh
      ? previewRemainingFrom(fresh.consumedSeconds, fresh.lastHeartbeatAt, now)
      : LIVE_PREVIEW_SECONDS;
    return remaining > 0
      ? { accessLevel: "preview", previewSecondsRemaining: remaining, accessGrantedByLiveCourseId: null }
      : { accessLevel: "preview_ended", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
  }

  const remaining = Math.max(0, LIVE_PREVIEW_SECONDS - consumed);
  return remaining > 0
    ? { accessLevel: "preview", previewSecondsRemaining: remaining, accessGrantedByLiveCourseId: null }
    : { accessLevel: "preview_ended", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
};

/**
 * POST /client/live-sessions/:id/preview/heartbeat — "still watching".
 *
 * `isPlaying: false` is treated as a stop: the app telling us playback paused is
 * the same fact as the app telling us it left, and honouring it here means a
 * pause is metered correctly even when the app never gets to send /preview/stop.
 *
 * `liveCourseIds` is the entitlement scope, exactly as on the join endpoint — a
 * heartbeat from an unpurchased course entry point must NOT be judged against
 * every linked course, or owning one linked course would silently report `full`
 * and stop metering a trial the student is genuinely consuming.
 */
export const previewHeartbeatSql = async (
  customerId: number,
  liveSessionId: number,
  liveCourseIds: number[],
  isPlaying: boolean
): Promise<LivePreviewTickSql> => {
  const trackingId = buildPreviewTrackingId(customerId, liveSessionId);
  // Ungated session, or a genuine purchase → no trial to meter, no row created.
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null, previewTrackingId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy, previewTrackingId: null };

  const state = await commitPreviewTick(customerId, liveSessionId, isPlaying);
  return { ...state, previewTrackingId: state.accessLevel === "preview" ? trackingId : null };
};

/**
 * POST /client/live-sessions/:id/preview/stop — pause, background, navigate away.
 *
 * Idempotent by construction: it commits whatever the open window owes and clears
 * the cursor. A second call finds `last_heartbeat_at` already NULL, so
 * `pendingPreviewCharge` returns 0 and the CAS rewrites the same values — the
 * remaining time it reports is identical. Stopping a trial that was never started
 * is likewise a no-op.
 */
export const previewStopSql = async (
  customerId: number,
  liveSessionId: number,
  liveCourseIds: number[]
): Promise<LivePreviewTickSql> => {
  const trackingId = buildPreviewTrackingId(customerId, liveSessionId);
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null, previewTrackingId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy, previewTrackingId: null };

  const state = await commitPreviewTick(customerId, liveSessionId, false);
  return { ...state, previewTrackingId: state.accessLevel === "preview" ? trackingId : null };
};

/**
 * Read-only batch preview lookup for LIST endpoints (Live Now): the accessLevel
 * a non-owner would get, WITHOUT starting anyone's clock. Only
 * resolveLivePreviewStateSql(track=true) — i.e. actually opening the player —
 * may create a preview row.
 */
export const previewLevelMapSql = async (
  customerId: number | null,
  liveSessionIds: number[]
): Promise<Map<number, "preview" | "preview_ended">> => {
  const out = new Map<number, "preview" | "preview_ended">();
  if (!customerId || !liveSessionIds.length) return out;
  const rows = await prisma.liveSessionPreview.findMany({
    where: { customerId, liveSessionId: { in: liveSessionIds } },
    select: { liveSessionId: true, consumedSeconds: true, lastHeartbeatAt: true },
    orderBy: { id: "asc" },
  });
  const now = new Date();
  for (const r of rows) {
    if (r.liveSessionId == null || out.has(r.liveSessionId)) continue; // first (oldest) row wins
    // Same watch-time rule as the detail endpoint, including any open window's
    // uncommitted time — a card must not advertise "preview" for a trial the
    // player would immediately end. Still strictly read-only: nothing is charged.
    out.set(r.liveSessionId, previewRemainingFrom(r.consumedSeconds, r.lastHeartbeatAt, now) > 0 ? "preview" : "preview_ended");
  }
  return out;
};

// ── recording auto-promote (ported from recording.promote.maybeAutoPromoteRecording; SQL) ──
const normalizeSubjectKey = (s?: string | null): string | null => {
  if (typeof s !== "string") return null;
  const k = s.trim().toLowerCase().replace(/\s+/g, " ");
  return k.length ? k : null;
};
const pickRecording = (recs: any[]): any | null => {
  if (!recs?.length) return null;
  for (const q of ["1080p", "720p", "480p", "360p", "240p", "144p"]) {
    const hit = recs.find((r) => r?.quality?.toLowerCase() === q);
    if (hit) return hit;
  }
  return recs[0] ?? null;
};
/**
 * Silent best-effort (never throws): file the best recording into each linked
 * course's CHOSEN folder (ws_live_session_course.folder_id, picked at
 * create/update). Courses with no folder chosen are skipped. Idempotent per
 * folder (dedupe by aws_id=path).
 */
export const maybeAutoPromoteRecordingSql = async (session: {
  id: number; title: string | null; recordings: any;
}): Promise<void> => {
  try {
    const recs = Array.isArray(session.recordings) ? session.recordings : [];
    const rec = pickRecording(recs);
    if (!rec?.path) return;
    const path = String(rec.path).replace(/(?:"|%22|%2522)+$/i, "");
    const links = await prisma.liveSessionCourse.findMany({
      where: { liveSessionId: session.id },
      select: { folderId: true },
    });
    const folderIds = Array.from(
      new Set(links.map((l) => l.folderId).filter((f): f is number => f != null))
    );
    for (const folderId of folderIds) {
      try {
        const folder = await prisma.videoCategory.findFirst({ where: { id: folderId }, select: { id: true } });
        if (!folder) continue;
        const dup = await prisma.video.findFirst({ where: { videoCategoryId: folderId, aws_id: path }, select: { id: true } });
        if (dup) continue;
        await prisma.video.create({
          data: { videoCategoryId: folderId, liveSessionId: session.id, title: session.title ?? "", topic: "", platform: "aws", slug: `rec-${Date.now().toString(36)}`, aws_id: path, priceType: "paid", order: 0, status: true } as any,
        });
      } catch { /* per-course best-effort */ }
    }
  } catch { /* non-fatal */ }
};

// ── listLiveCoursesForClient ────────────────────────────────────────────────
export const listClient = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const now = Date.now();
  const [rows, total] = await Promise.all([
    repo.listClientCourses({ search: q.search, now: new Date(), sort: "ordered", skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countClientCourses({ search: q.search, now: new Date() }),
  ]);
  const ids = rows.map((r) => r.id);
  const [daysLeft, counts, owned, plans] = await Promise.all([getDaysLeftMap(customerId, ids), getPurchaseCounts(ids), getOwnedCourseIds(customerId), plansGrouped(ids)]);
  // hero ranking: top-2 upcoming by purchase count
  const upcoming = rows.filter((r) => r.startTime && r.startTime.getTime() > now).map((r) => ({ id: String(r.id), score: counts.get(String(r.id)) ?? 0 })).sort((a, b) => b.score - a.score);
  const featuredId = upcoming[0]?.id ?? null, comingSoonId = upcoming[1]?.id ?? null;
  const liveCourses = rows.map((r) => {
    const key = String(r.id);
    return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: owned.has(key), purchaseCount: counts.get(key) ?? 0, cardVariant: key === featuredId ? "featured" : key === comingSoonId ? "coming_soon" : null, plans: splitPlansByMaterial(plans.get(r.id) ?? []) };
  });
  return { liveCourses, total, page: q.page, limit: q.limit };
};

// ── Recently Added Live Courses (standalone API) ─────────────────────────────
// Newest active live courses (pure createdAt desc — NOT the listing's
// ordered-first sort), decorated with the SAME plans / daysLeft / isPurchased
// contract as listClient so a card here and the /client/live-courses listing
// agree. No hero ranking (that's listing-only). Paginated.
export const listRecentLiveCourses = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const where: Prisma.LiveCourseWhereInput = { status: true };
  const nameSearch = buildPrismaSearch(q.search, ["name"]);
  if (nameSearch) Object.assign(where, nameSearch);
  const [rows, total] = await Promise.all([
    prisma.liveCourse.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.liveCourse.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { liveCourses: [], total, page: q.page, limit: q.limit };
  const [daysLeft, owned, plans] = await Promise.all([
    getDaysLeftMap(customerId, ids),
    getOwnedCourseIds(customerId),
    plansGrouped(ids),
  ]);
  const liveCourses = rows.map((r) => {
    const key = String(r.id);
    return {
      ...toCourseDto(r),
      daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null,
      isPurchased: owned.has(key),
      plans: plans.get(r.id) ?? [],
    };
  });
  return { liveCourses, total, page: q.page, limit: q.limit };
};

// ── listUpcomingLiveBatches ──────────────────────────────────────────────────
export const listUpcomingBatches = async (customerId: number | null, q: { search?: string; categoryId?: number; page: number; limit: number }) => {
  const now = new Date();
  const [rows, total, catCounts] = await Promise.all([
    repo.listClientCourses({ search: q.search, upcomingOnly: true, packageCategoryId: q.categoryId, now, sort: "startTime", skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countClientCourses({ search: q.search, upcomingOnly: true, packageCategoryId: q.categoryId, now }),
    repo.upcomingCategoryCounts(now),
  ]);
  const ids = rows.map((r) => r.id);
  const [daysLeft, counts, owned] = await Promise.all([getDaysLeftMap(customerId, ids), getPurchaseCounts(ids), getOwnedCourseIds(customerId)]);
  const liveBatches = rows.map((r) => { const key = String(r.id); return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: owned.has(key), purchaseCount: counts.get(key) ?? 0 }; });
  // category tab bar: resolve PackageCategory (ws_package_category) for title/slug/
  // image; unknown ids fall back to nulls. The "All" count is the sum.
  const catRows = await repo.packageCategoriesByIds([...catCounts.keys()]);
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const categories = [...catCounts].map(([catId, count]) => {
    const c = catById.get(catId);
    return { _id: String(catId), title: c?.title ?? null, slug: c?.slug ?? null, image: c?.image ?? null, count };
  });
  const allCount = [...catCounts.values()].reduce((n, c) => n + c, 0);
  return { liveBatches, total, page: q.page, limit: q.limit, categories, allCount, selectedCategoryId: q.categoryId ? String(q.categoryId) : null };
};

// ── listMyLiveCourses ────────────────────────────────────────────────────────
export const listMyCourses = async (customerId: number | null) => {
  if (!customerId) return { liveCourses: [], total: 0 };
  const ownedIds = await repo.ownedCourseIds(customerId, new Date());
  const [rows, daysLeft, plans] = await Promise.all([repo.coursesByIdsActive(ownedIds), getDaysLeftMap(customerId, ownedIds), plansGrouped(ownedIds)]);
  const liveCourses = rows.map((r) => { const key = String(r.id); return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: true, plans: plans.get(r.id) ?? [] }; });
  return { liveCourses, total: liveCourses.length };
};

// ── cross-course session feeds (all-upcoming / live-now / my-upcoming) ────────
/**
 * One row per PHYSICAL session — a session shared by several courses appears
 * exactly once (repo dedupes on session id), carrying ALL of its linked courses.
 *
 * Per-row entitlement fields (`liveCourses[].isPurchased`, `subscribed`,
 * `accessLevel`) are resolved in two batched queries for the whole page, not one
 * pair per row. They are UI HINTS ONLY — tapping through re-runs the real gate in
 * GET /client/live-sessions/:id, which is the sole authority.
 */
const sessionFeed = async (
  courseIds: number[],
  customerId: number | null,
  mode: "upcoming" | "liveNow",
  search: string | undefined,
  page: number,
  limit: number
) => {
  const { rows, total, courseBySession } = await repo.sessionsForCourses(courseIds, { upcoming: mode === "upcoming", liveNow: mode === "liveNow", search, now: new Date(), skip: (page - 1) * limit, take: limit });
  if (!rows.length) return { sessions: [], total, page, limit };

  const linkedIds = [...new Set(rows.flatMap((s) => courseBySession.get(s.id) ?? []))];
  const [courses, owned, previewLevels] = await Promise.all([
    linkedIds.length
      ? prisma.liveCourse.findMany({ where: { id: { in: linkedIds } }, select: { id: true, name: true, image: true } })
      : Promise.resolve([] as { id: number; name: string; image: string | null }[]),
    getOwnedCourseIds(customerId),
    previewLevelMapSql(customerId, rows.map((s) => s.id)),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const sessions = rows.map((s) => {
    const ids = courseBySession.get(s.id) ?? [];
    const liveCourses = ids
      .map((id) => courseById.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ _id: String(c.id), name: c.name, image: c.image ?? null, isPurchased: owned.has(String(c.id)) }));
    // Live Now semantics: owning ANY linked course is full access. A session with
    // no linked course is ungated (nothing to buy), matching the detail endpoint.
    const subscribed = ids.length === 0 || liveCourses.some((c) => c.isPurchased);
    return {
      ...toSessionDto(s),
      sessionId: String(s.id),
      liveCourseIds: ids.map(String),
      liveCourses,
      subscribed,
      accessLevel: subscribed ? "full" : previewLevels.get(s.id) ?? "preview",
    };
  });
  return { sessions, total, page, limit };
};

export const listAllUpcomingSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  // All visible courses' upcoming sessions (discovery feed) — every active course.
  const all = await repo.listClientCourses({ now: new Date(), sort: "ordered", skip: 0, take: 1000 });
  return sessionFeed(all.map((c) => c.id), customerId, "upcoming", q.search, q.page, q.limit);
};

export const listLiveNowSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const all = await repo.listClientCourses({ now: new Date(), sort: "ordered", skip: 0, take: 1000 });
  return sessionFeed(all.map((c) => c.id), customerId, "liveNow", q.search, q.page, q.limit);
};

export const listMyUpcomingSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  if (!customerId) return { sessions: [], total: 0, page: q.page, limit: q.limit };
  const owned = await repo.ownedCourseIds(customerId, new Date());
  return sessionFeed(owned, customerId, "upcoming", q.search, q.page, q.limit);
};

// ── sessions for one course (client) ──────────────────────────────────────────
export const listSessionsForCourseClient = async (id: number, q: { status?: string; upcoming?: string; search?: string; page?: string; limit?: string }): Promise<"not_found" | { sessions: any[]; total: number; page: number; limit: number }> => {
  return listSessionsForCourse(id, q); // same shape as the admin sessions-for-course
};

// ── schedule (folders+entries JSON) for a course, with daysLeft ───────────────
export const getScheduleForCourse = async (customerId: number | null, id: number): Promise<"not_found" | { scheduleFolders: any[]; daysLeft: number | null }> => {
  const row = await repo.findById(id);
  if (!row || !row.status) return "not_found";
  const folders = jArr(row.scheduleFolders).slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((f: any) => ({ _id: f._id, title: f.title, image: f.image ?? null, order: f.order ?? 0, status: f.status !== false, entries: [...(f.entries ?? [])].sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0)) }));
  const dl = await getDaysLeftMap(customerId, [id]);
  return { scheduleFolders: folders, daysLeft: dl.has(String(id)) ? dl.get(String(id)) ?? null : null };
};

export const getScheduleFolderForClient = async (id: number, folderId: string): Promise<"not_found" | "folder_not_found" | { scheduleFolder: any }> => {
  const row = await repo.findById(id);
  if (!row || !row.status) return "not_found";
  const folder = jArr(row.scheduleFolders).find((f: any) => String(f._id) === folderId);
  if (!folder) return "folder_not_found";
  return { scheduleFolder: { _id: folder._id, title: folder.title, image: folder.image ?? null, order: folder.order ?? 0, status: folder.status !== false, entries: [...(folder.entries ?? [])].sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0)) } };
};

// ── GET /:id/schedule (timetable + scheduleFolders) — SQL ─────────────────────
// Mirrors the Mongo getLiveCourseSchedule contract: timetable = sessions with a
// scheduledAt (educator populated), scheduleFolders = the course's active folder
// JSON, plus daysLeft. Session educator comes from ws_live_session.educator_id.
export const getScheduleForClient = async (
  courseId: number,
  customerId: number | null,
  upcoming: boolean
): Promise<"not_found" | { liveCourse: { _id: string; name: string }; timetable: any[]; scheduleFolders: any[]; total: number; daysLeft: number | null }> => {
  const course = await repo.findById(courseId);
  if (!course || !course.status) return "not_found";

  const now = new Date();
  const { rows } = await repo.sessionsForCourse(courseId, { upcoming, now, skip: 0, take: 500 });
  const sched = rows.filter((s) => s.scheduledAt != null);
  // upcoming → ascending; otherwise future-first (nearest), then past most-recent-first.
  const ordered = upcoming
    ? sched.sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
    : sched.sort((a, b) => {
        const fa = a.scheduledAt!.getTime() >= now.getTime() ? 0 : 1;
        const fb = b.scheduledAt!.getTime() >= now.getTime() ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return Math.abs(a.scheduledAt!.getTime() - now.getTime()) - Math.abs(b.scheduledAt!.getTime() - now.getTime());
      });

  // Populate session-level educator ({ _id, name, image } | null).
  const eduIds = [...new Set(ordered.map((s) => s.educatorId).filter((n): n is number => n != null))];
  const eduById = new Map<number, { _id: string; name: string | null; image: string | null }>();
  if (eduIds.length) {
    const edus = await Promise.all(eduIds.map((eid) => repo.findEducator(eid)));
    for (const e of edus) if (e) eduById.set(e.id, { _id: String(e.id), name: e.name ?? null, image: e.image ?? null });
  }

  const timetable = ordered.map((s) => ({
    sessionId: String(s.id),
    subject: s.subject || s.title,
    title: s.title,
    educator: s.educatorId != null ? eduById.get(s.educatorId) ?? null : null,
    date: s.scheduledAt ?? null,
    startAt: s.scheduledAt ?? null,
    startAtDisplay: formatScheduledAt(s.scheduledAt),
    endAt: s.endAt ?? null,
    status: s.status,
    streamId: s.streamId ?? null,
  }));

  const scheduleFolders = jArr(course.scheduleFolders)
    .filter((f: any) => f.status !== false)
    .slice()
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((f: any) => ({
      _id: String(f._id),
      title: f.title,
      image: f.image ?? null,
      order: f.order ?? 0,
      status: f.status !== false,
      entries: (f.entries ?? []).slice().sort(
        (a: any, b: any) => ((a.order ?? 0) - (b.order ?? 0)) || (new Date(a.date).getTime() - new Date(b.date).getTime())
      ),
    }));

  const daysLeftMap = await getDaysLeftMap(customerId, [courseId]);
  const daysLeft = daysLeftMap.has(String(courseId)) ? daysLeftMap.get(String(courseId)) ?? null : null;

  return { liveCourse: { _id: String(course.id), name: course.name }, timetable, scheduleFolders, total: timetable.length, daysLeft };
};

// ── GET /my/schedule (owned courses' schedule folders) — SQL ──────────────────
// Mirrors the Mongo listMyScheduleByCategory contract: for every owned live
// course (active/lifetime verified sub), its active schedule folders + daysLeft.
export const listMyScheduleForClient = async (customerId: number) => {
  const now = new Date();
  const ownedIds = await repo.ownedCourseIds(customerId, now);
  if (!ownedIds.length) return { liveCourses: [], totalLiveCourses: 0 };
  const [courses, daysLeftMap] = await Promise.all([
    prisma.liveCourse.findMany({
      where: { id: { in: ownedIds }, status: true },
      select: { id: true, name: true, image: true, scheduleFolders: true },
    }),
    getDaysLeftMap(customerId, ownedIds),
  ]);
  const liveCourses = courses.map((c) => {
    const folders = jArr(c.scheduleFolders)
      .filter((f: any) => f.status !== false)
      .slice()
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      .map((f: any) => ({
        _id: String(f._id),
        title: f.title,
        image: f.image ?? null,
        order: f.order ?? 0,
        entryCount: Array.isArray(f.entries) ? f.entries.length : 0,
      }));
    const key = String(c.id);
    return {
      _id: String(c.id),
      name: c.name,
      image: c.image,
      scheduleFolders: folders,
      daysLeft: daysLeftMap.has(key) ? daysLeftMap.get(key) ?? null : null,
    };
  });
  return { liveCourses, totalLiveCourses: liveCourses.length };
};

// ════════════════════════════════════════════════════════════════════════════
// Live-course FOLDER + VIDEO persistence (ws_video_category + ws_video)
//   SQL mirror of src/admin/live-course/live-course.folder.controller.ts and
//   src/admin/live-course/live-course.video.controller.ts.
//
// Gated behind the SEPARATE `admin-live-course` flag (the rest of this file is
// `live-course`) so folders/videos can be flipped independently. The legacy
// controllers branch on `isAdminLiveCourseMysql()` BEFORE the ObjectId guard.
//
// SCOPING DRIFT: ws_video_category has NO `live_course_id` column (Mongo-only
// field). So a folder "belongs to" a live course iff it is reachable from the
// course's root folder (ws_live_course.video_category_id) via the relation DAG.
// We reuse the catalog-category-tree resolver (descendantsOf) for that walk; the
// course root itself counts. listFolders therefore returns root + descendants.
// Videos have no live-session backlink column, so from-recording stores the mp4
// path as aws_id + platform="aws" and dedupes per folder by (vcategory_id,aws_id).
// ════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../config/prisma";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";

export const ADMIN_LIVE_COURSE_MODULE = "admin-live-course";
export const isAdminLiveCourseMysql = (): boolean => true;

function lcSlugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ── DTOs (Mongo-shaped: `_id` is the stringified int) ─────────────────────────
export const folderDto = (f: any) => ({
  _id: String(f.id),
  title: f.title,
  slug: f.slug ?? null,
  image: f.image ?? null,
  parent: idStrOrNull(f.parent),
  educatorId: idStrOrNull(f.educatorId),
  order_by: f.order_by ?? 0,
  status: f.status,
  createdAt: f.created_at ?? null,
  updatedAt: f.updated_at ?? null,
});

export const relationDto = (r: any) => ({
  _id: String(r.id),
  parent: String(r.parent),
  child: String(r.child),
  order: r.order ?? 0,
});

export const videoDto = (v: any) => ({
  _id: String(v.id),
  title: v.title,
  topic: v.topic ?? "",
  platform: v.platform,
  priceType: v.priceType,
  youtube_id: v.youtube_id ?? null,
  aws_id: v.aws_id ?? null,
  vimeo_id: v.vimeo_id ?? null,
  videoCategoryId: idStrOrNull(v.videoCategoryId),
  order: v.order ?? 0,
  status: v.status,
  createdAt: v.created_at ?? null,
  updatedAt: v.updated_at ?? null,
});

const lcVideoSelect = {
  id: true, title: true, topic: true, platform: true, priceType: true,
  youtube_id: true, aws_id: true, vimeo_id: true, videoCategoryId: true,
  order: true, status: true, created_at: true, updated_at: true,
} as const;

// ── scope helpers (course ↔ folder reachability via the relation DAG) ─────────
/** The live course's root folder id (ws_live_course.video_category_id), or null. */
const lcRootFolderId = async (liveCourseId: number): Promise<number | null> => {
  const lc = await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { videoCategoryId: true } });
  return lc ? lc.videoCategoryId ?? null : null;
};

/** Does a live course row exist? */
export const lcCourseExists = async (liveCourseId: number): Promise<boolean> =>
  !!(await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { id: true } }));

/** Folder ids reachable from the course root (INCLUSIVE). Empty if no root set. */
const lcReachableFolderIds = async (liveCourseId: number): Promise<number[]> => {
  const root = await lcRootFolderId(liveCourseId);
  if (!root) return [];
  return descendantsOf([root]);
};

/**
 * Folder belongs to course iff its `live_course_id` column matches. We key on the
 * flat column (not the root/DAG) so that admin folder ops and the client recordings
 * reader (getRecordingsForClient, which also filters by liveCourseId) agree — a
 * folder created via the API is consistently visible to both. lcCreateFolder stamps
 * liveCourseId on every folder it creates.
 */
export const lcFolderBelongsToCourse = async (folderId: number, liveCourseId: number): Promise<boolean> =>
  !!(await prisma.videoCategory.findFirst({ where: { id: folderId, liveCourseId }, select: { id: true } }));

// ── folder handlers ───────────────────────────────────────────────────────────
/**
 * listFolders: every folder owned by the course (by liveCourseId) + relation rows.
 * Optional `search` filters by folder title (case-insensitive `contains`, per the
 * table's default CI collation) — used by the admin folder picker.
 */
export const lcListFolders = async (
  liveCourseId: number,
  search?: string
): Promise<{ folders: any[]; relations: any[] }> => {
  const where: any = { liveCourseId };
  const titleSearch = buildPrismaSearch(search, ["title"]);
  if (titleSearch) Object.assign(where, titleSearch);
  const folders = await prisma.videoCategory.findMany({
    where,
    orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
  });
  if (!folders.length) return { folders: [], relations: [] };
  const ids = folders.map((f) => f.id);
  const relations = await prisma.videoCategoryRelation.findMany({ where: { OR: [{ parent: { in: ids } }, { child: { in: ids } }] } });
  return { folders: folders.map(folderDto), relations: relations.map(relationDto) };
};

/** createFolder. Inserts a relation row when parentFolderId is given. */
export const lcCreateFolder = async (
  liveCourseId: number,
  input: { title: string; image?: string; parentFolderId?: number; order_by?: number; educatorId?: number; status?: boolean }
): Promise<{ folder: any } | "bad_parent"> => {
  if (input.parentFolderId != null && !(await lcFolderBelongsToCourse(input.parentFolderId, liveCourseId))) return "bad_parent";
  const lc = await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { image: true } });
  const fallbackImage = lc?.image ?? "";
  const now = new Date();
  const created = await prisma.videoCategory.create({
    data: {
      title: input.title,
      slug: `${lcSlugify(input.title)}-${Date.now().toString(36)}`,
      image: input.image ?? fallbackImage,
      // `ws_video_category.parent` is NOT NULL in the DB (0 = top-level), even
      // though the introspected model types it `Int?`. Default to 0 so a folder
      // with no parent saves instead of throwing a null-constraint error.
      parent: input.parentFolderId ?? 0,
      // Stamp the owning live course so the folder is reachable by the recordings
      // reader (getRecordingsForClient filters by liveCourseId). Mirrors the Mongo path.
      liveCourseId,
      // `educator_id` is also NOT NULL (default 0) in the DB despite the model
      // typing it `Int?`. Default to 0 ("no educator") rather than null.
      educatorId: input.educatorId ?? 0,
      order_by: input.order_by ?? 0,
      status: input.status ?? true,
      created_at: now,
      updated_at: now,
    },
  });
  if (input.parentFolderId != null) {
    await prisma.videoCategoryRelation.create({ data: { parent: input.parentFolderId, child: created.id, order: input.order_by ?? 0 } });
  }
  return { folder: folderDto(created) };
};

/** updateFolder. Returns the DTO, or null if the folder is not in this course. */
export const lcUpdateFolder = async (
  liveCourseId: number,
  folderId: number,
  input: { title?: string; image?: string; order_by?: number; educatorId?: number; status?: boolean }
): Promise<any | null> => {
  if (!(await lcFolderBelongsToCourse(folderId, liveCourseId))) return null;
  const data: any = { updated_at: new Date() };
  if (input.title !== undefined) data.title = input.title;
  if (input.image !== undefined) data.image = input.image;
  if (input.order_by !== undefined) data.order_by = input.order_by;
  if (input.educatorId !== undefined) data.educatorId = input.educatorId;
  if (input.status !== undefined) data.status = input.status;
  const updated = await prisma.videoCategory.update({ where: { id: folderId }, data });
  return folderDto(updated);
};

/**
 * deleteFolder. Refuses the course root folder. Cascades: deletes all videos in
 * the folder + relations referencing it, then the folder itself.
 */
export const lcDeleteFolder = async (
  liveCourseId: number,
  folderId: number
): Promise<{ ok: true; deletedVideos: number; deletedRelations: number } | "not_found" | "is_root"> => {
  if (!(await lcFolderBelongsToCourse(folderId, liveCourseId))) return "not_found";
  const root = await lcRootFolderId(liveCourseId);
  if (root != null && root === folderId) return "is_root";
  const [videos, relations] = await Promise.all([
    prisma.video.deleteMany({ where: { videoCategoryId: folderId } }),
    prisma.videoCategoryRelation.deleteMany({ where: { OR: [{ parent: folderId }, { child: folderId }] } }),
  ]);
  await prisma.videoCategory.delete({ where: { id: folderId } });
  return { ok: true, deletedVideos: videos.count, deletedRelations: relations.count };
};

// ── video handlers ────────────────────────────────────────────────────────────
/** listVideosInFolder: videos in a folder ordered by order asc; DB-paginated.
 *  Each row carries its global `order` (reorder stays page-independent). */
export const lcListVideosInFolder = async (
  folderId: number,
  opts?: { skip?: number; take?: number }
): Promise<{ data: any[]; total: number }> => {
  const [rows, total] = await Promise.all([
    prisma.video.findMany({
      where: { videoCategoryId: folderId },
      orderBy: [{ order: "asc" }, { created_at: "asc" }, { id: "asc" }],
      select: lcVideoSelect,
      skip: opts?.skip,
      take: opts?.take,
    }),
    prisma.video.count({ where: { videoCategoryId: folderId } }),
  ]);
  return { data: rows.map(videoDto), total };
};

/** createVideoInFolder: add a manual video (youtube/aws/vimeo). */
export const lcCreateVideoInFolder = async (
  folderId: number,
  input: { title: string; topic?: string; platform: "youtube" | "aws" | "vimeo"; priceType?: "free" | "paid"; youtube_id?: string; aws_id?: string; vimeo_id?: string; order?: number; status?: boolean }
): Promise<any> => {
  const now = new Date();
  const created = await prisma.video.create({
    data: {
      videoCategoryId: folderId,
      title: input.title,
      topic: input.topic ?? "",
      platform: input.platform,
      priceType: input.priceType ?? "paid",
      youtube_id: input.youtube_id ?? null,
      aws_id: input.aws_id ?? null,
      vimeo_id: input.vimeo_id ?? null,
      slug: `${lcSlugify(input.title)}-${Date.now().toString(36)}`,
      order: input.order ?? 0,
      status: input.status ?? true,
      created_at: now,
      updated_at: now,
    },
    select: lcVideoSelect,
  });
  return videoDto(created);
};

/** Resolve a recording from the JSON array by quality → index → best quality. */
const lcResolveRecording = (recordings: any[], opts: { recordingIndex?: number; quality?: string }): any | null => {
  if (!recordings.length) return null;
  if (opts.quality) {
    const q = opts.quality.toLowerCase();
    return recordings.find((r) => String(r?.quality ?? "").toLowerCase() === q) ?? null;
  }
  if (typeof opts.recordingIndex === "number") return recordings[opts.recordingIndex] ?? null;
  for (const q of ["1080p", "720p", "480p", "360p", "240p", "144p"]) {
    const hit = recordings.find((r) => String(r?.quality ?? "").toLowerCase() === q);
    if (hit) return hit;
  }
  return recordings[0] ?? null;
};

/**
 * createVideoFromRecording. Reads the live session's recordings JSON, picks one
 * by index/quality, files its mp4 path into the folder as an aws video. Dedupes
 * per folder by (vcategory_id, aws_id) — same key as the Mongo promote helper.
 */
export const lcCreateVideoFromRecording = async (
  folderId: number,
  input: { liveSessionId: number; recordingIndex?: number; quality?: string; title?: string; priceType?: "free" | "paid"; order?: number }
): Promise<{ video: any; alreadyExisted: boolean } | "session_not_found" | "no_recordings" | "recording_not_found" | "no_path"> => {
  const session = await prisma.liveSession.findFirst({ where: { id: input.liveSessionId }, select: { id: true, title: true, recordings: true } });
  if (!session) return "session_not_found";
  const recordings = Array.isArray(session.recordings) ? (session.recordings as any[]) : [];
  if (recordings.length === 0) return "no_recordings";
  const recording = lcResolveRecording(recordings, { recordingIndex: input.recordingIndex, quality: input.quality });
  if (!recording) return "recording_not_found";
  const rawPath: string | undefined = recording.path;
  if (!rawPath) return "no_path";
  const path = rawPath.replace(/(?:"|%22|%2522)+$/i, "");
  const existing = await prisma.video.findFirst({ where: { videoCategoryId: folderId, aws_id: path }, select: lcVideoSelect });
  if (existing) return { video: videoDto(existing), alreadyExisted: true };
  const title = input.title ?? session.title ?? "Recording";
  const now = new Date();
  const created = await prisma.video.create({
    data: {
      videoCategoryId: folderId,
      title,
      topic: "",
      platform: "aws",
      aws_id: path,
      priceType: input.priceType ?? "paid",
      slug: `${lcSlugify(title)}-${Date.now().toString(36)}`,
      order: input.order ?? 0,
      status: true,
      created_at: now,
      updated_at: now,
    },
    select: lcVideoSelect,
  });
  return { video: videoDto(created), alreadyExisted: false };
};

/** deleteVideoInFolder. Scoped to the folder. Returns whether a row was deleted. */
export const lcDeleteVideoInFolder = async (folderId: number, videoId: number): Promise<boolean> => {
  const res = await prisma.video.deleteMany({ where: { id: videoId, videoCategoryId: folderId } });
  return res.count > 0;
};

/** getVideoInFolder. Returns the DTO, or null if not in this folder. */
export const lcGetVideoInFolder = async (folderId: number, videoId: number): Promise<any | null> => {
  const row = await prisma.video.findFirst({ where: { id: videoId, videoCategoryId: folderId }, select: lcVideoSelect });
  return row ? videoDto(row) : null;
};

/** updateVideoInFolder. Scoped to the folder. Returns DTO or null (not found). */
export const lcUpdateVideoInFolder = async (
  folderId: number,
  videoId: number,
  input: { title?: string; topic?: string; platform?: "youtube" | "aws" | "vimeo"; priceType?: "free" | "paid"; youtube_id?: string; aws_id?: string; vimeo_id?: string; order?: number; status?: boolean }
): Promise<any | null> => {
  const existing = await prisma.video.findFirst({ where: { id: videoId, videoCategoryId: folderId }, select: { id: true } });
  if (!existing) return null;
  const data: any = { updated_at: new Date() };
  if (input.title !== undefined) data.title = input.title;
  if (input.topic !== undefined) data.topic = input.topic;
  if (input.platform !== undefined) data.platform = input.platform;
  if (input.priceType !== undefined) data.priceType = input.priceType;
  if (input.youtube_id !== undefined) data.youtube_id = input.youtube_id;
  if (input.aws_id !== undefined) data.aws_id = input.aws_id;
  if (input.vimeo_id !== undefined) data.vimeo_id = input.vimeo_id;
  if (input.order !== undefined) data.order = input.order;
  if (input.status !== undefined) data.status = input.status;
  const updated = await prisma.video.update({ where: { id: videoId }, data, select: lcVideoSelect });
  return videoDto(updated);
};

/**
 * reorderVideosInFolder. Only videos that actually live in this folder are
 * touched (ids from elsewhere are silently ignored). Returns matched/modified.
 */
export const lcReorderVideosInFolder = async (
  folderId: number,
  orders: { id: number; order: number }[]
): Promise<{ matched: number; modified: number }> => {
  let matched = 0;
  for (const { id, order } of orders) {
    const res = await prisma.video.updateMany({ where: { id, videoCategoryId: folderId }, data: { order, updated_at: new Date() } });
    matched += res.count;
  }
  return { matched, modified: matched };
};
