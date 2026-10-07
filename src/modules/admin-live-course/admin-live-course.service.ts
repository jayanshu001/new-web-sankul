// Live courses: admin management plus client listings, recordings, preview and live chat logic.
import ExcelJS from "exceljs";
import { countPlanUsage, countPlanUsageOne } from "../../utils/planUsage";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import type { ReportSource } from "../../utils/reportStream";
import { computeEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import { parseMaterialCategoryRefs } from "./admin-live-course.refs";
import { andWhere, statusWhere, normalizeStatus, reportRow, blankStrToNull, decToNum, rowHasMaterial, trackingToNumber } from "../../utils/reportFilters";
import { adminAuthRepository } from "../admin-auth/admin-auth.repository";
import { deriveRole } from "../admin-auth/admin-auth.transformer";
import type { LiveCourse, LiveCourseOrder, LiveCoursePlan, LiveCourseSubscription, LiveSession, Prisma } from "@prisma/client";
// Value import: the type-only line above cannot supply the Decimal constructor.
import { Prisma as PrismaRuntime } from "@prisma/client";
// Shared course/material money split, so a live-course grant books it like a package sub.
import { computeMaterialSplit } from "../commerce-order/commerce-order.service";

/**
 * A subscription row read with its order; any DTO carrying amount / gateway ids / code
 * snapshots needs this shape. `order` is nullable only because the FK is.
 */
type LiveSubWithOrder = LiveCourseSubscription & { order: LiveCourseOrder | null };
import { getVodStreamMeta } from "../../admin/live/streamos.service";
import { providerOf, getRecordingByAssetId } from "../../admin/live/streamos.provider";
import { redisClient } from "../../config/redis";
import { buildPagination } from "../../utils/listQuery";
import { nextOrder } from "../../utils/listOrdering";
import { buildPrismaSearch, buildPrismaPrefixSearch, matchesAllTokens } from "../../utils/searchFilter";
// Same DAG source the admin category pickers use, so the FE maps one shape everywhere.
import { primaryParentMap } from "../../utils/videoCategoryRelation";
import { resolveAncestors } from "../../utils/categoryAncestors";
import { buildPreviewTrackingId } from "../../utils/previewTracking";
import { fmtExportDate } from "../../utils/csvExport";
import { appendAdminRemark, movedRemarkText, planAddDays, planDateShift, planDeactivation, planDeactivationRevert, planQueuedStart, type DateShift } from "../../utils/subscriptionRemarkHistory";


export const parseLiveId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStrOrNull = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);
const jArr = (v: any): any[] => (Array.isArray(v) ? v : []);


// Synthetic ids for JSON schedule folders/entries (addressed by `_id`).
let _seq = 0;
const synthId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(_seq++).toString(36)}${Math.floor(performance.now()).toString(36)}`;

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
  isMostPopular: (p as any).isMostPopular ?? false, // computed, read-only (plan-popularity)
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
  // No explicit `ordered` → previous row + 1 (utils/listOrdering); the admin list sorts
  // by recency and is unaffected.
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
  // Mirror the attachments onto the entitlement pivot (see repository).
  if (v.materialCategories !== undefined) {
    await repo.syncMaterialCategoryPivot(created.id, parseMaterialCategoryRefs(v.materialCategories));
  }
  // No root folder: ws_video_category has no live_course_id.
  return { liveCourse: toCourseDto(created), rootFolder: null };
};

/**
 * Bulk drag-and-drop reorder, same contract as banner-slider.service.reorderBanners:
 * unparseable ids are skipped, the count is rows written, and 0 ("no valid ids")
 * becomes a 400 in the controller. One transaction so a drag can't half-apply.
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
  // Keep the entitlement pivot in step with the JSON column on every re-save.
  if (v.materialCategories !== undefined) {
    await repo.syncMaterialCategoryPivot(id, parseMaterialCategoryRefs(v.materialCategories));
  }
  return { liveCourse: toCourseDto(updated) };
};

export const deleteLiveCourse = async (id: number): Promise<"not_found" | "has_sessions" | { id: string; deletedFolders: number; deletedVideos: number; deletedRelations: number }> => {
  if (!(await repo.exists(id))) return "not_found";
  // Block if sessions are attached.
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

export const listPlans = async (
  liveCourseId: number,
  opts: { skip: number; take: number; page: number; limit: number }
): Promise<{ data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  const [plans, total] = await Promise.all([
    repo.listPlans(liveCourseId, opts.skip, opts.take),
    repo.countPlans(liveCourseId),
  ]);
  // All-time, status-blind: a pending or failed order pins the plan just as a verified
  // one does (utils/planUsage).
  const usage = await countPlanUsage("livePlan", plans.map((pl) => pl.id));
  return {
    data: plans.map((pl) => ({ ...toPlanDto(pl), orderCount: usage.get(pl.id) ?? 0 })),
    pagination: buildPagination(total, opts.page, opts.limit),
  };
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

// Frozen once saved; `name`, `status` and the editorial `isDefault` stay writable.
const LIVE_PLAN_FROZEN = ["duration", "price", "originalPrice", "withMaterial", "materialPrice"] as const;

export const updatePlan = async (planId: number, v: any): Promise<"not_found" | "frozen_terms" | any> => {
  const plan = await repo.findPlanById(planId);
  if (!plan) return "not_found";
  // Only an actual change is refused: the product form re-sends stored values (including
  // `status`) on a paid→free switch and must keep working.
  const changesFrozen = LIVE_PLAN_FROZEN.some(
    (k) => v[k] !== undefined && (v[k] ?? 0) !== ((plan as any)[k] ?? 0)
  );
  if (changesFrozen) return "frozen_terms";

  if (v.isDefault === true) await repo.clearDefaultPlans(plan.liveCourseId, planId);
  const data: any = { updatedAt: new Date() };
  for (const k of ["name", "isDefault", "status"]) if (v[k] !== undefined) data[k] = v[k];
  const updated = await repo.updatePlan(planId, data);
  return toPlanDto(updated);
};

// Refuses while any order references the plan (returns { inUse }).
export const deletePlan = async (planId: number): Promise<"not_found" | { inUse: number } | true> => {
  if (!(await repo.findPlanById(planId))) return "not_found";
  // Pending and failed orders reference the plan as firmly as verified ones.
  const inUse = await countPlanUsageOne("livePlan", planId);
  if (inUse > 0) return { inUse };
  await repo.deletePlan(planId);
  return true;
};

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

// Entries live in a JSON column, so pagination is an in-memory slice of the
// order-sorted array; `total` is the full count.
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

// `isAdmin` + `role` let the FE style admin messages identically on history reload and
// live `new_message`. No stored role column (only is_admin + admin_id), so `role` is
// resolved from the admin's current spatie roles at read time; customers get null.
const toChatMessageDto = (m: any, role: string | null = null) => ({ _id: String(m.id), customerId: idStrOrNull(m.customerId), userName: m.userName ?? null, message: m.message ?? null, isAdmin: !!m.isAdmin, role: m.isAdmin ? role : null, isPrivate: !!m.isPrivate, targetCustomerId: idStrOrNull(m.targetCustomerId), createdAt: m.createdAt ?? null });

/**
 * One live class's chat listing. `scope` selects one mode so public and private
 * threads never render as one mixed array:
 *   - omitted             → every message, both modes (admin history default)
 *   - { isPrivate:false } → the public timeline
 *   - { isPrivate:true }  → the private thread, narrowed by `viewerId` for a student
 *                           (own messages, host replies to them, host messages to
 *                           nobody) and unnarrowed for the host.
 * Always chronological (oldest → newest).
 */
export const getChatHistory = async (
  liveClassId: string,
  limit: number,
  before?: Date,
  scope?: { isPrivate?: boolean; viewerId?: number | null }
) => {
  const rows = await repo.chatHistory(liveClassId, limit, before, scope);
  // Batch-resolve the current role of every admin author on this page (one pivot query).
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
  return rows.reverse().map((m: any) => toChatMessageDto(m, roleFor(m))); // chronological order
};

export const getChatBanStatus = async (customerId: number) => {
  const ban = await repo.chatBanForCustomer(customerId);
  return ban ? { isBanned: true, reason: ban.reason ?? null, bannedAt: ban.createdAt ?? null } : { isBanned: false, reason: null, bannedAt: null };
};

/**
 * Persist a customer live-chat message (socket `send_message`): like
 * sendAdminChatMessage but writes customerId and isAdmin:false. Returns the shape the
 * socket emits as `new_message`.
 */
export const sendCustomerChatMessage = async (input: { liveClassId: string; customerId: number | null; userName?: string | null; message: string; isPrivate?: boolean }) => {
  const now = new Date();
  // isPrivate is the mode active at send time and is never rewritten when the host
  // toggles later, so both histories coexist and are served one at a time.
  const created = await repo.createChatMessage({ liveClassId: input.liveClassId, customerId: input.customerId, adminId: null, isAdmin: false, isPrivate: !!input.isPrivate, userName: input.userName ?? "", message: input.message, createdAt: now, updatedAt: now });
  return { _id: String(created.id), liveClassId: created.liveClassId, customerId: idStrOrNull(created.customerId), userName: created.userName, message: created.message, isPrivate: created.isPrivate, createdAt: created.createdAt };
};

/** Socket send_message guard. */
export const isCustomerChatBanned = async (customerId: number): Promise<boolean> =>
  !!(await repo.chatBanForCustomer(customerId));

export const sendAdminChatMessage = async (input: { liveClassId: string; adminId: number | null; userName?: string | null; message: string; isPrivate?: boolean; targetCustomerId?: number | null }) => {
  const now = new Date();
  // targetCustomerId addresses a private reply to one student (they and the admins see
  // it, nobody else). Left null, a private host message goes to the whole room: private
  // mode hides students from each other, not the host from the class.
  const created = await repo.createChatMessage({ liveClassId: input.liveClassId, customerId: null, adminId: input.adminId, isAdmin: true, isPrivate: !!input.isPrivate, targetCustomerId: input.isPrivate ? input.targetCustomerId ?? null : null, userName: input.userName ?? "Admin", message: input.message, createdAt: now, updatedAt: now });
  return { _id: String(created.id), liveClassId: created.liveClassId, userName: created.userName, message: created.message, isAdmin: true, isPrivate: created.isPrivate, targetCustomerId: idStrOrNull(created.targetCustomerId), createdAt: created.createdAt };
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
  // liveClassId is a LiveSession StreamOS streamId; resolve it so the panel can show the session.
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

export interface ChatSettings {
  chatEnabled: boolean;
  privateChat: boolean;
}

/** Defaults: chat on, public. */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { chatEnabled: true, privateChat: false };

/** Defaults when no row is saved. */
export const getChatSettings = async (liveClassId: string): Promise<ChatSettings> => {
  const row = await repo.chatSettingFor(liveClassId);
  return row
    ? { chatEnabled: row.chatEnabled, privateChat: row.privateChat }
    : { ...DEFAULT_CHAT_SETTINGS };
};

/** Upserts a partial patch; returns the full updated object. */
export const updateChatSettings = async (
  liveClassId: string,
  patch: { chatEnabled?: boolean; privateChat?: boolean }
): Promise<ChatSettings> => {
  const row = await repo.upsertChatSetting(liveClassId, patch);
  return { chatEnabled: row.chatEnabled, privateChat: row.privateChat };
};

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
 * Record a student's vote (socket `submit_vote`). Validates the poll is active and the
 * option index in range, then returns the full fresh poll DTO so the socket can
 * broadcast exact tallies on `poll_update`. String results map to the socket's error
 * emits. One vote per (poll, customer), locked server-side: a second submit returns
 * "already_voted" and changes nothing. A new poll is a new pollId.
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
  | "already_voted"
> => {
  const poll = await repo.findPoll(pollId);
  if (!poll) return "not_found";
  if (!poll.isActive) return "closed";
  const options = await repo.pollOptions(pollId);
  if (optionIndex < 0 || optionIndex >= options.length) return "invalid_option";
  // Check + insert + counter bumps run in one transaction, so two concurrent submits from
  // the same customer cannot both count.
  if (!(await repo.recordPollVoteOnce(pollId, customerId, optionIndex))) return "already_voted";
  const fresh = await repo.findPoll(pollId);
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
  // Close any currently active poll for the class first.
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
 * Only permitted while the poll is active with zero votes. Guard failures return
 * strings the controller maps to HTTP codes/messages; otherwise the poll DTO with
 * reloaded options.
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

import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { qualitiesFromSessionRecordings } from "../../utils/videoQualities";
import { signMediaToken } from "../../utils/mediaToken";
import { formatScheduledAt } from "../../utils/displayTime";

// StreamOS sometimes appends stray quote chars to recording paths; strip them.
const sanitizeRecPath = <T extends string | null | undefined>(p: T): T =>
  (typeof p === "string" ? (p.replace(/(?:"|%22|%2522)+$/i, "") as T) : p);

// Best (highest-resolution) MP4 url for the convenience `mp4Url` field; falls back to
// the first entry, or null.
const pickBestMp4 = (recs: Array<{ quality: string | null; path: string }>): string | null => {
  if (!recs.length) return null;
  const heightOf = (q: string | null) => Number(String(q ?? "").match(/(\d+)/)?.[1] ?? 0);
  return [...recs].sort((a, b) => heightOf(b.quality) - heightOf(a.quality))[0]?.path ?? recs[0].path ?? null;
};

export const hasAccessToAnyLiveCourse = async (customerId: number | null, liveCourseIds: number[]): Promise<boolean> => {
  if (!customerId || !liveCourseIds.length) return false;
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, new Date());
  return subs.length > 0;
};

/**
 * Like hasAccessToAnyLiveCourse but reports the winning course for
 * `accessGrantedByLiveCourseId`. Resolves in the caller's id order so course-scoped
 * (single id) and Live Now (all linked ids) calls give a stable answer. null = none.
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

// Days left per course from active subs (null = lifetime); empty for guests.
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

// Plan DTO with originalPrice/discountPercent enrichment (matches the client listing).
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

// packageCategoryId and courseEducatorId are surfaced as bare ids.
export const plansGrouped = async (courseIds: number[]) => {
  const plans = await repo.activePlansForCourses(courseIds);
  const byCourse = new Map<number, any[]>();
  for (const p of plans) { const a = byCourse.get(p.liveCourseId) ?? []; a.push(toClientPlan(p)); byCourse.set(p.liveCourseId, a); }
  return byCourse;
};

// { withMaterial, withoutMaterial } split used by the client course and live-course
// detail endpoints.
export const splitPlansByMaterial = (arr: any[]) => ({
  withMaterial: arr.filter((p) => p.withMaterial),
  withoutMaterial: arr.filter((p) => !p.withMaterial),
});

// courseEducatorId and packageCategoryId are populated. subjectsCount = schedule
// folders (JSON); materialsCount has no column → 0. Never returns playback URLs.
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

  // A deactivated live course stays hidden from non-owners, but active subscribers keep
  // full access to its detail and content.
  if (!row.status && !subscribed) return "not_found";

  const planList = plansRaw
    .filter((p) => p.status)
    .sort((a, b) => a.price - b.price)
    .map((p) => toClientPlan(p));
  // Split by material variant, same as the package detail contract
  // (catalog-package.detail.sql.ts).
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

// endAt sort key: a lifetime entitlement (endAt null) never expires → Infinity.
const subEndKey = (endAt: Date | null | undefined) => (endAt ? endAt.getTime() : Infinity);

/**
 * Collapse a customer's live-course subscription rows to one card per course. Extend
 * creates a new row (one order = one row), but "My live courses" is an entitlement
 * view: after Extend Validity the student sees one card whose validity moved out.
 * The winner is the strongest entitlement (currently active beats lapsed, then
 * furthest endAt) and carries plan + subscriptionId; the window spans the group's
 * earliest start and the furthest end among equally strong rows (lifetime wins).
 * Same collapse as getDaysLeftMap, so daysLeft matches every other surface.
 */
const mergeLiveSubsPerCourse = <
  T extends { id: number; liveCourseId: number | null; startAt: Date | null; endAt: Date | null; status: boolean | null }
>(rows: T[], now: Date): T[] => {
  // Is this row a live entitlement now? Only the "all" filter can mix ranks.
  const rank = (s: T) => (s.status === true && (s.endAt == null || s.endAt.getTime() >= now.getTime()) ? 1 : 0);

  const groups = new Map<string, T[]>();
  const order: string[] = []; // preserve the repository's createdAt-desc ordering
  for (const s of rows) {
    // Rows with no course attached can't be merged; keep them as-is.
    const key = s.liveCourseId != null && s.liveCourseId > 0 ? `l:${s.liveCourseId}` : `s:${s.id}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else { groups.set(key, [s]); order.push(key); }
  }

  return order.map((key) => {
    const g = groups.get(key) as T[];
    if (g.length === 1) return g[0];

    const top = Math.max(...g.map(rank));
    const pool = g.filter((s) => rank(s) === top);
    const winner = pool.reduce((best, s) => (subEndKey(s.endAt) > subEndKey(best.endAt) ? s : best));

    const starts = g.map((s) => s.startAt).filter((d): d is Date => d != null);
    const startAt = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const endAt = pool.some((s) => s.endAt == null)
      ? null
      : new Date(Math.max(...pool.map((s) => (s.endAt as Date).getTime())));

    return { ...winner, startAt, endAt };
  });
};

/**
 * Sessions behind the My Live Batches card: unit key → video ids. A unit is one class,
 * not one ws_video row: a recording filed into several folders must count once, so
 * live-linked rows collapse per live session and a manual video is its own unit. Only
 * playable rows count (source id present; a live-linked session is READY with
 * recordings), so scheduled / live / processing streams never reach the total.
 */
const recordingSessionUnits = async (folderIds: number[]): Promise<Map<string, number[]>> => {
  const units = new Map<string, number[]>();
  if (!folderIds.length) return units;
  const videos = (
    await prisma.video.findMany({
      where: { status: true, videoCategoryId: { in: folderIds } },
      select: { id: true, liveSessionId: true, aws_id: true, youtube_id: true, vimeo_id: true },
    })
  ).filter((v) => v.aws_id || v.youtube_id || v.vimeo_id);
  const sessionIds = [...new Set(videos.map((v) => v.liveSessionId).filter((n): n is number => n != null))];
  const sessions = sessionIds.length
    ? await prisma.liveSession.findMany({ where: { id: { in: sessionIds }, status: "READY" }, select: { id: true, recordings: true } })
    : [];
  const ready = new Set(sessions.filter((s) => Array.isArray(s.recordings) && s.recordings.length > 0).map((s) => s.id));
  for (const v of videos) {
    if (v.liveSessionId != null && !ready.has(v.liveSessionId)) continue;
    const key = v.liveSessionId != null ? `s:${v.liveSessionId}` : `v:${v.id}`;
    units.set(key, [...(units.get(key) ?? []), v.id]);
  }
  return units;
};

export const listMyLiveCoursesForClient = async (
  customerId: number,
  filterStatus: string,
  baseUrl?: string,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
) => {
  const now = new Date();
  const subs = mergeLiveSubsPerCourse(await repo.myLiveCourseSubs(customerId, filterStatus, now), now);
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

  // "X of Y sessions completed": a session is a recorded class (the unit progress
  // heartbeats drive), so the ratio stays <= 100%. total = playable classes under the
  // course's folders (recordingSessionUnits); completed = those finished in this
  // live-course container, any copy of a recording counting.
  const totalByCourse = new Map<number, number>();
  const doneByCourse = new Map<number, number>();
  await Promise.all(courseIds.map(async (id) => {
    const folders = await prisma.videoCategory.findMany({ where: { liveCourseId: id, status: true }, select: { id: true } });
    const units = [...(await recordingSessionUnits(folders.map((f) => f.id))).values()];
    const doneRows = units.length
      ? await prisma.lectureProgress.findMany({
          where: { customerId, liveCourseId: id, completed: true, videoId: { in: units.flat() } },
          select: { videoId: true },
        })
      : [];
    const doneIds = new Set(doneRows.map((r) => r.videoId));
    totalByCourse.set(id, units.length);
    doneByCourse.set(id, units.filter((ids) => ids.some((v) => doneIds.has(v))).length);
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
      // Rows are already gated to purchased subscriptions (LIVE_SUB_PURCHASED), so this is
      // always "verified"; kept so the DTO shape is unchanged.
      paymentStatus: "verified",
      active,
      daysLeft: active ? computeDaysLeft(s.endAt ?? null, now) : 0,
      progress: {
        completedSessions,
        totalSessions,
        percentCompleted: totalSessions > 0 ? Math.min(100, Math.round((completedSessions / totalSessions) * 100)) : 0,
      },
    };
  });
  // Rows are hydrated in memory, so search + pagination run over the assembled array.
  const filtered = q.search
    ? liveCourses.filter((c) => matchesAllTokens(q.search, [c.liveCourse?.name]))
    : liveCourses;
  const total = filtered.length;
  const paged = filtered.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);
  return { liveCourses: paged, total, page: q.page, limit: q.limit };
};

// Active courses with their active plans (cheapest first) for purchase pickers.
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

// Recordings are immutable once StreamOS produces them; the TTL still picks up a
// re-processed/late recording within the hour.
const VOD_META_CACHE_TTL_SEC = 3600;

type VodRec = { quality: string | null; file_size: number | null; path: string };
interface CachedVodMeta {
  hlsUrl: string | null;
  hls: VodRec[];
  mp4: VodRec[];
}

/** What resolveVodMeta needs off a session row to know where to resolve. */
type VodSessionRef = {
  streamId: string | null;
  streamProvider?: string | null;
  recordedAssetId?: string | null;
};

/**
 * Resolve a session's StreamOS VOD into playable URLs via get-vod-stream-meta,
 * Redis-cached per id. null on any failure so the caller falls back to stored webhook
 * recordings. The accessKey never leaves the server; only CDN URLs reach the client.
 */
const resolveVodMeta = async (session: VodSessionRef): Promise<CachedVodMeta | null> => {
  const streamId = String(session.streamId ?? "");
  if (!streamId) return null;

  const isV1 = providerOf(session) === "v1";
  // v1 recordings are library assets addressed by asset id. Without one the recording
  // hasn't landed or is still transcoding; the caller falls back to stored recs.
  const assetId = session.recordedAssetId ?? null;
  if (isV1 && !assetId) return null;

  // Namespaced per provider: independent id spaces, so a shared key could serve a
  // legacy resolution for a v1 id.
  const cacheKey = isV1 ? `vodmeta:v1:${assetId}` : `vodmeta:${streamId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached) as CachedVodMeta;
  } catch {
    /* cache read best-effort */
  }
  try {
    const meta = isV1
      ? await getRecordingByAssetId(String(assetId))
      : await getVodStreamMeta(streamId);
    const norm = (r: { quality: string; path: string }): VodRec => ({
      quality: r.quality || null,
      file_size: null,
      path: sanitizeRecPath(r.path),
    });
    const out: CachedVodMeta = { hlsUrl: meta.hlsUrl ?? null, hls: meta.hls.map(norm), mp4: meta.mp4.map(norm) };
    // Only cache a non-empty resolution so a transient blip isn't pinned.
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

type RecordingVideo = Prisma.VideoGetPayload<Record<string, never>>;

const shapeStoredRecs = (raw: unknown): VodRec[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
    .map((r: any) => ({
      quality: typeof r.quality === "string" ? r.quality : null,
      file_size: typeof r.file_size === "number" ? r.file_size : null,
      path: sanitizeRecPath(r.path),
    }));

/**
 * Recording Videos → client lecture DTOs (VOD resolution with stored-webhook fallback,
 * media token, resume progress). Shared by all three recordings reads so they emit
 * byte-identical lectures; never fork it per endpoint.
 */
const shapeRecordingLectures = async (
  courseId: number,
  customerId: number | null,
  subscribed: boolean,
  videos: RecordingVideo[]
): Promise<any[]> => {
  if (!videos.length) return [];

  // Per-quality recordings from the source live session.
  const sessionIds = [...new Set(videos.map((v) => v.liveSessionId).filter((n): n is number => n != null))];
  const recBySession = new Map<number, VodRec[]>();
  // VOD-meta-resolved playable URLs per session (get-vod-stream-meta, cached).
  const vodBySession = new Map<number, CachedVodMeta | null>();
  if (sessionIds.length) {
    const sessions = await prisma.liveSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        streamId: true,
        recordings: true,
        // Needed to pick the right StreamOS API and address a v1 recording.
        streamProvider: true,
        recordedAssetId: true,
      },
    });
    for (const s of sessions) recBySession.set(s.id, shapeStoredRecs(s.recordings));
    // Playable URLs via StreamOS get-vod-stream-meta (cached), failure-isolated per
    // session: one that can't resolve falls back to its stored webhook recordings.
    await Promise.all(
      sessions
        .filter((s) => !!s.streamId)
        .map(async (s) => {
          vodBySession.set(s.id, await resolveVodMeta(s));
        })
    );
  }

  const progByVideo = new Map<number, any>();
  if (customerId) {
    const rows = await prisma.lectureProgress.findMany({
      where: { customerId, videoId: { in: videos.map((v) => v.id) } },
      select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
    });
    for (const r of rows) if (r.videoId != null) progByVideo.set(r.videoId, r);
  }

  return videos.map((v) => {
    const canPlay = subscribed || v.priceType === "free";
    const p = progByVideo.get(v.id);
    // Only cleartext metadata the list screen needs (qualities, preferred stream hint).
    // No playable URL / source id: the client exchanges `mediaToken` at /media/resolve.
    const vod = v.liveSessionId ? vodBySession.get(v.liveSessionId) ?? null : null;
    const storedHls = v.liveSessionId ? recBySession.get(v.liveSessionId) ?? [] : [];
    const hlsList = vod?.hls?.length ? vod.hls : storedHls;
    const hasHls = !!(vod?.hlsUrl || hlsList.length);
    // Locked (unpurchased paid) → no token. Free → free token; purchased → scoped to the
    // live course so resolve can re-check entitlement.
    const mediaToken =
      !canPlay || customerId == null
        ? null
        : v.priceType === "free"
        ? signMediaToken({ k: "liveRecording", id: v.id, free: true, cust: customerId })
        : signMediaToken({ k: "liveRecording", id: v.id, scope: { kind: "liveCourse", id: courseId }, cust: customerId });
    return {
      _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, isFree: v.priceType === "free", order: v.order,
      locked: !canPlay,
      preferredStream: (hasHls ? "hls" : "mp4") as "hls" | "mp4",
      qualities: qualitiesFromSessionRecordings(hlsList),
      mediaToken,
      progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
    };
  });
};

/**
 * Course + entitlement preamble for the recordings reads. A deactivated live course
 * still serves recordings to active subscribers but 404s for everyone else.
 */
const loadRecordingsContext = async (
  courseId: number,
  customerId: number | null
): Promise<"not_found" | { course: any; subscribed: boolean; daysLeft: number | null }> => {
  const course = await repo.findById(courseId);
  if (!course) return "not_found";
  const subscribed = await hasAccessToAnyLiveCourse(customerId, [courseId]);
  if (!course.status && !subscribed) return "not_found";
  const daysLeftMap = await getDaysLeftMap(customerId, [courseId]);
  return { course, subscribed, daysLeft: daysLeftMap.has(String(courseId)) ? daysLeftMap.get(String(courseId)) ?? null : null };
};

const recordingFolderWhere = (courseId: number) => ({ liveCourseId: courseId, status: true });
const RECORDING_FOLDER_ORDER = [{ order_by: "asc" as const }, { created_at: "asc" as const }];
const RECORDING_FOLDER_SELECT = { id: true, title: true, image: true, order_by: true };

type RecordingFolderRow = { id: number; title: string | null; slug?: string | null; image?: string | null; order_by?: number | null; status?: boolean | null; created_at?: Date | null; updated_at?: Date | null };

/**
 * Hierarchy overlay for recording folder rows (folders nest via
 * ws_video_category_relation, see lcCreateFolder). Emits the catalog directory
 * contract: `parent` / `childCategoryIds` / `havingChildDirectory` / `count`, as
 * client-catalog.catalogMaterials/catalogVideos and the /children drill-downs do.
 * `count`: a directory reports its child-folder count, a leaf its subtree lecture count.
 * Edges are scoped to this course's folders on both ends, so a folder shared with
 * another course never leaks a foreign parent or child.
 */
const buildRecordingFolderTree = async (folders: RecordingFolderRow[]) => {
  const ids = folders.map((f) => f.id);
  const edges = ids.length
    ? await prisma.videoCategoryRelation.findMany({
        where: { parent: { in: ids }, child: { in: ids } },
        select: { parent: true, child: true, order: true },
      })
    : [];
  // The relation table is a DAG; collapse to one parent per folder so `parent` stays
  // single-valued (same rule as the admin pickers).
  const primaryParent = primaryParentMap(edges);
  const childrenOf = new Map<number, number[]>();
  for (const e of [...edges].sort((a, b) => a.order - b.order || a.child - b.child)) {
    // Only the primary edge counts, else a multi-parent folder is listed twice.
    if (!e.parent || !e.child || primaryParent.get(e.child) !== e.parent) continue;
    const arr = childrenOf.get(e.parent) ?? [];
    if (!arr.includes(e.child)) arr.push(e.child);
    childrenOf.set(e.parent, arr);
  }
  const childIds = (id: number): number[] => childrenOf.get(id) ?? [];
  /** Self + every descendant, cycle-guarded. */
  const subtree = (id: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      stack.push(...childIds(cur));
    }
    return out;
  };
  return {
    childIds,
    subtree,
    /** Top-level folders of this course: no parent inside the course. */
    isRoot: (id: number) => (primaryParent.get(id) ?? 0) <= 0,
    meta: (id: number) => {
      const parent = primaryParent.get(id) ?? null;
      const kids = childIds(id);
      return {
        parent: parent ? String(parent) : null,
        childCategoryIds: kids.map(String),
        havingChildDirectory: kids.length > 0,
      };
    },
  };
};

/** Catalog directory `count`: directory → child-folder count, leaf → lectures in its subtree. */
const folderCatalogCount = (
  tree: { childIds: (id: number) => number[]; subtree: (id: number) => number[] },
  lecturesByFolder: Map<number, number>,
  id: number
): number => {
  const kids = tree.childIds(id);
  return kids.length
    ? kids.length
    : tree.subtree(id).reduce((n, fid) => n + (lecturesByFolder.get(fid) ?? 0), 0);
};

export const getRecordingsForClient = async (
  courseId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number; parentId?: string } = { page: 1, limit: 20 }
): Promise<"not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  const folders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folderIds = folders.map((f) => f.id);
  const videos = folderIds.length
    ? await prisma.video.findMany({ where: { videoCategoryId: { in: folderIds }, status: true }, orderBy: [{ order: "asc" }, { created_at: "asc" }] })
    : [];

  const shaped = await shapeRecordingLectures(courseId, customerId, subscribed, videos);
  const byFolder = new Map<number, any[]>();
  videos.forEach((v, i) => {
    const a = byFolder.get(v.videoCategoryId as number) ?? [];
    a.push(shaped[i]);
    byFolder.set(v.videoCategoryId as number, a);
  });

  const tree = await buildRecordingFolderTree(folders);
  const lecturesByFolder = new Map<number, number>();
  for (const v of videos) {
    const fid = v.videoCategoryId as number;
    lecturesByFolder.set(fid, (lecturesByFolder.get(fid) ?? 0) + 1);
  }
  // Deliberately flat (sub-folders included): this reader ships each folder's
  // `lectures[]`, so hiding sub-folders would hide lectures. Callers can group by
  // `parent`. The tree screen uses ?summary=1, which is roots-only.
  const allFolders = folders.map((f) => ({
    folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
    ...tree.meta(f.id),
    count: folderCatalogCount(tree, lecturesByFolder, f.id),
    lectures: byFolder.get(f.id) ?? [],
  }));

  // Lecture-title search drops non-matching lectures (and now-empty folders);
  // pagination is over folders. totalLectures reflects the filtered set.
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

/**
 * Hub variant of getRecordingsForClient: folder name + lecture count only, from a SQL
 * groupBy (no Video rows, VOD resolution or token signing). Paginated over folders.
 */
export const getRecordingFolderSummaryForClient = async (
  courseId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number; parentId?: string } = { page: 1, limit: 20 }
): Promise<"not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  const folders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folderIds = folders.map((f) => f.id);
  const counts = folderIds.length
    ? await prisma.video.groupBy({
        by: ["videoCategoryId"],
        where: { videoCategoryId: { in: folderIds }, status: true, ...(buildPrismaSearch(q.search, ["title"]) ?? {}) },
        _count: { _all: true },
      })
    : [];
  const countByFolder = new Map(counts.map((c) => [c.videoCategoryId as number, c._count._all]));

  const tree = await buildRecordingFolderTree(folders);
  // Roots only: sub-folders are reached through GET /recordings/:folderId/children,
  // like material categories. Listing children beside their parent broke the tree.
  const allFolders = folders
    .filter((f) => tree.isRoot(f.id))
    .map((f) => ({
      folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
      ...tree.meta(f.id),
      count: folderCatalogCount(tree, countByFolder, f.id),
      lectureCount: countByFolder.get(f.id) ?? 0,
    }));
  // Search keeps a folder if anything in its subtree matches, so the path to a hit stays
  // walkable. Without a search every root is kept, including empty ones (count 0).
  const matchCount = (f: { folderId: string }) =>
    tree.subtree(Number(f.folderId)).reduce((n, id) => n + (countByFolder.get(id) ?? 0), 0);
  const filteredFolders = q.search ? allFolders.filter((f) => matchCount(f) > 0) : allFolders;
  const totalLectures = filteredFolders.reduce((n, f) => n + matchCount(f), 0);

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    subscribed, daysLeft, totalLectures,
    folders: filteredFolders.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit),
    total: filteredFolders.length, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

/**
 /**
  * One folder's lectures, paginated by lecture (the "open folder" screen). Same
  * entitlement rules as the full response: locked lectures carry no media token.
  */
export const getRecordingFolderDetailForClient = async (
  courseId: number,
  folderId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
): Promise<"not_found" | "folder_not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  // The whole course folder set feeds the hierarchy overlay and proves the folder
  // belongs to this course; otherwise any folder id would be readable via any course.
  const allFolders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) return "folder_not_found";
  const tree = await buildRecordingFolderTree(allFolders);

  const where = { videoCategoryId: folder.id, status: true, ...(buildPrismaSearch(q.search, ["title"]) ?? {}) };
  // Subtree counts drive the catalog-contract `count` on the folder itself.
  const subtreeIds = tree.subtree(folder.id);
  const [subtreeCounts, videos, total] = await Promise.all([
    prisma.video.groupBy({ by: ["videoCategoryId"], where: { videoCategoryId: { in: subtreeIds }, status: true }, _count: { _all: true } }),
    prisma.video.findMany({ where, orderBy: [{ order: "asc" }, { created_at: "asc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.video.count({ where }),
  ]);
  const countByFolder = new Map(subtreeCounts.map((c) => [c.videoCategoryId as number, c._count._all]));

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    folderId: String(folder.id), title: folder.title, image: folder.image, order: folder.order_by,
    // `havingChildDirectory` cues the FE to call GET /recordings/:folderId/children;
    // sub-folders are not inlined because they page separately.
    ...tree.meta(folder.id),
    count: folderCatalogCount(tree, countByFolder, folder.id),
    lectureCount: total,
    lectures: await shapeRecordingLectures(courseId, customerId, subscribed, videos),
    subscribed, daysLeft,
    total, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

/**
 * GET /:id/recordings/:folderId/children: sub-folders of one recording folder, paginated.
 * Same `{ parent, list: [{ category }] }` composition as catalog-material.getCategoryChildren
 * and catalog-video.getVideoCategoryChildren, but course-scoped: a folder id from another
 * course 404s here instead of resolving.
 */
export const getRecordingFolderChildrenForClient = async (
  courseId: number,
  folderId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
): Promise<"not_found" | "folder_not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  const allFolders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) return "folder_not_found";
  const tree = await buildRecordingFolderTree(allFolders);

  const byId = new Map(allFolders.map((f) => [f.id, f]));
  // Children keep their admin order (RECORDING_FOLDER_ORDER), not the edge order, so a
  // folder sorts the same here as on the hub.
  const orderedChildIds = allFolders.map((f) => f.id).filter((id) => tree.childIds(folder.id).includes(id));
  const matching = orderedChildIds.filter((id) => matchesAllTokens(q.search, [byId.get(id)?.title ?? ""]));
  const pageIds = matching.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);

  // One groupBy over the page's subtrees plus the parent: leaf `count` is a subtree
  // lecture count, and the parent row reports its own `lectureCount` like any hub row.
  const countIds = [...new Set([folder.id, ...pageIds.flatMap((id) => tree.subtree(id))])];
  const counts = countIds.length
    ? await prisma.video.groupBy({ by: ["videoCategoryId"], where: { videoCategoryId: { in: countIds }, status: true }, _count: { _all: true } })
    : [];
  const countByFolder = new Map(counts.map((c) => [c.videoCategoryId as number, c._count._all]));

  const folderDto = (id: number) => {
    const f = byId.get(id)!;
    return {
      folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
      ...tree.meta(f.id),
      count: folderCatalogCount(tree, countByFolder, f.id),
      lectureCount: countByFolder.get(f.id) ?? 0,
    };
  };

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    parent: folderDto(folder.id),
    list: pageIds.map((id) => ({ category: folderDto(id) })),
    subscribed, daysLeft,
    total: matching.length, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

// Ownership check only; the controller does encryptLecture.
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

export const listSessionRecordingsForClient = async (
  courseId: number,
  customerId: number | null,
  page: number,
  limit: number,
  search?: string
): Promise<"not_found" | { liveCourse: any; subscribed: boolean; total: number; page: number; limit: number; lectures: any[] }> => {
  const course = await repo.findById(courseId);
  if (!course) return "not_found";
  // A deactivated live course still serves its session recordings to active
  // subscribers; 404 for everyone else.
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

// Live-session preview/trial window length, in seconds.
export const PREVIEW_SECONDS = 180;
const LIVE_PREVIEW_SECONDS = PREVIEW_SECONDS;

/**
 /**
  * Heartbeat interval while playback is active, published in the join response so it
  * is a server decision rather than an app constant.
  */
export const PREVIEW_HEARTBEAT_SECONDS = 10;

/**
 /**
  * The most watch time one heartbeat may ever charge. Consumption is charged as
  * (now − last_heartbeat_at), so if the app dies without /preview/stop the cursor
  * freezes; without a cap, returning an hour later would bill the hour. Capping at one
  * missed interval plus slack makes an abandoned window self-limit, no sweeper needed.
  * Must stay > PREVIEW_HEARTBEAT_SECONDS or ordinary jitter under-charges every tick.
  */
export const PREVIEW_STALE_SECONDS = 20;

export type LivePreviewStateSql = {
  accessLevel: "full" | "preview" | "preview_ended";
  previewSecondsRemaining: number;
  /** The linked course that granted `full` (null on preview/preview_ended). */
  accessGrantedByLiveCourseId: number | null;
};

/**
 /**
  * Watch time owed by a still-open window but not yet committed to `consumed_seconds`.
  * Reads include it, or a client that heartbeats and re-joins would see its remaining
  * time snap back up. Capped by PREVIEW_STALE_SECONDS like the heartbeat charge, so the
  * two agree and an abandoned window stops growing. Computed only, never persisted:
  * only a heartbeat or stop advances `consumed_seconds`.
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

/** The trial row for one (customer, session), oldest wins (see resolveLivePreviewStateSql). */
const oldestPreviewRow = (customerId: number, liveSessionId: number) =>
  prisma.liveSessionPreview.findFirst({ where: { customerId, liveSessionId }, orderBy: { id: "asc" } });

/**
 * Access decision for one live session and caller. `liveCourseIds` is the entitlement
 * scope: opened from a course → `[thatCourseId]` only, so owning a different course
 * linked to the same shared session does not unlock it; opened from Live Now → every
 * linked course, any active one grants full access.
 *
 * The trial row is keyed on (customer, session), not course, so re-entering via another
 * unpurchased course, device or reinstall continues the same window.
 *
 * `track` (session is not SCHEDULED) gates row creation only. A new row starts at
 * consumed_seconds = 0 with no open window; consumption begins at the first heartbeat.
 * Reads never charge, so re-joining without heartbeats never moves the number.
 */
export const resolveLivePreviewStateSql = async (
  customerId: number | null,
  liveSessionId: number,
  liveCourseIds: number[],
  track: boolean
): Promise<LivePreviewStateSql> => {
  // A session linked to no course is ungated.
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  // Full access short-circuits before any preview row is touched, so a paying student
  // never gets a tracking record.
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy };
  if (!customerId) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };

  const now = new Date();
  // Always the earliest row: if a race (or a pre-unique-index duplicate) wrote two, the
  // first still bounds the window, so a concurrent request can never restart the clock.
  let preview = await oldestPreviewRow(customerId, liveSessionId);

  if (!preview) {
    // Nothing watched yet. Don't create a row for a SCHEDULED (unplayable) session; report
    // the untouched allowance read-only.
    if (!track) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    // createMany({ skipDuplicates }) → INSERT IGNORE, so losing the race against
    // uq_live_session_preview_customer_session is a no-op rather than a logged P2002. It
    // relies on the DB constraint, not a schema.prisma @@unique; where the index is missing
    // a duplicate is inserted, which oldest-row-wins renders harmless.
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

export type LivePreviewTickSql = LivePreviewStateSql & { previewTrackingId: string | null };

/**
 /**
  * Commit the watch time owed by an open window, leaving it open (`keepOpen`, a
  * heartbeat) or closed (stop / pause).
  *
  * Compare-and-swap, not read-modify-write: two devices (or a heartbeat racing a retry)
  * can read the same cursor and both add the same charge, draining the trial at 2×.
  * Guarding the UPDATE on the cursor value read makes exactly one writer win; the loser
  * sees `count === 0` and re-reads without charging. Total consumption therefore never
  * exceeds the wall-clock time at least one device was playing.
  *
  * A single conditional UPDATE also stays correct under the IST middleware (it shifts
  * `where` and `data` alike); raw SQL would bypass the shift and mis-compare by 5.5h.
  */
const commitPreviewTick = async (
  customerId: number,
  liveSessionId: number,
  keepOpen: boolean
): Promise<LivePreviewStateSql> => {
  const now = new Date();
  let preview = await oldestPreviewRow(customerId, liveSessionId);

  if (!preview) {
    // First heartbeat with no prior join (or a SCHEDULED session that never made a row).
    // Open the window charging nothing: there is no cursor to measure from.
    if (!keepOpen) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    await prisma.liveSessionPreview.createMany({
      data: [{ customerId, liveSessionId, startedAt: now, consumedSeconds: 0, lastHeartbeatAt: now, createdAt: now }],
      skipDuplicates: true,
    });
    preview = await oldestPreviewRow(customerId, liveSessionId);
    if (!preview) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    // Lost the insert race: treat the winner's row as ours.
  }

  const charge = pendingPreviewCharge(preview.lastHeartbeatAt, now);
  const consumed = Math.min(LIVE_PREVIEW_SECONDS, Math.max(0, preview.consumedSeconds) + charge);
  // Once the allowance is gone the window closes regardless of `keepOpen`; a leftover
  // cursor would make the next read compute a phantom pending charge.
  const exhausted = consumed >= LIVE_PREVIEW_SECONDS;
  const nextCursor = keepOpen && !exhausted ? now : null;

  const written = await prisma.liveSessionPreview.updateMany({
    // CAS: `lastHeartbeatAt: <value read>` compiles to `= ?` or `IS NULL`, so a concurrent
    // writer that already moved the cursor makes this match 0 rows.
    where: { id: preview.id, lastHeartbeatAt: preview.lastHeartbeatAt ?? null },
    data: { consumedSeconds: consumed, lastHeartbeatAt: nextCursor },
  });

  if (written.count === 0) {
    // Someone else committed first; their charge covers this interval (shared cursor), so
    // report their result instead of double-billing.
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
 * POST /client/live-sessions/:id/preview/heartbeat ("still watching").
 * `isPlaying: false` is treated as a stop, so a pause is metered even if the app never
 * sends /preview/stop. `liveCourseIds` is the entitlement scope as on join: judging a
 * heartbeat from an unpurchased entry point against every linked course would report
 * `full` and stop metering a trial the student is consuming.
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
 * POST /client/live-sessions/:id/preview/stop (pause, background, navigate away).
 * Idempotent: commits what the open window owes and clears the cursor; a second call
 * finds `last_heartbeat_at` NULL, so `pendingPreviewCharge` is 0 and the CAS rewrites
 * the same values. Stopping a never-started trial is a no-op.
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
 * Read-only batch preview lookup for list endpoints (Live Now): the accessLevel a
 * non-owner would get, without starting anyone's clock. Only
 * resolveLivePreviewStateSql(track=true), i.e. opening the player, may create a row.
 */
export const previewLevelMapSql = async (
  customerId: number | null,
  liveSessionIds: number[]
): Promise<Map<number, { accessLevel: "preview" | "preview_ended"; previewSecondsRemaining: number }>> => {
  const out = new Map<number, { accessLevel: "preview" | "preview_ended"; previewSecondsRemaining: number }>();
  if (!customerId || !liveSessionIds.length) return out;
  const rows = await prisma.liveSessionPreview.findMany({
    where: { customerId, liveSessionId: { in: liveSessionIds } },
    select: { liveSessionId: true, consumedSeconds: true, lastHeartbeatAt: true },
    orderBy: { id: "asc" },
  });
  const now = new Date();
  for (const r of rows) {
    if (r.liveSessionId == null || out.has(r.liveSessionId)) continue; // first (oldest) row wins
    // Same watch-time rule as the detail endpoint, including an open window's uncommitted
    // time, so a card never advertises a trial the player would end at once. Never charges.
    const remaining = previewRemainingFrom(r.consumedSeconds, r.lastHeartbeatAt, now);
    out.set(r.liveSessionId, { accessLevel: remaining > 0 ? "preview" : "preview_ended", previewSecondsRemaining: remaining });
  }
  return out;
};

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
 * Best-effort, never throws: files the best recording into each linked course's chosen
 * folder (ws_live_session_course.folder_id). Courses without a folder are skipped.
 * Idempotent per folder (dedupe by aws_id = path).
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

// Client listing with daysLeft/isPurchased/plans; top-2 upcoming by sales get hero card variants.
export const listClient = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const now = Date.now();
  const [rows, total] = await Promise.all([
    repo.listClientCourses({ search: q.search, now: new Date(), sort: "ordered", skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countClientCourses({ search: q.search, now: new Date() }),
  ]);
  const ids = rows.map((r) => r.id);
  const [daysLeft, counts, owned, plans] = await Promise.all([getDaysLeftMap(customerId, ids), getPurchaseCounts(ids), getOwnedCourseIds(customerId), plansGrouped(ids)]);
  // Hero ranking: top-2 upcoming by purchase count.
  const upcoming = rows.filter((r) => r.startTime && r.startTime.getTime() > now).map((r) => ({ id: String(r.id), score: counts.get(String(r.id)) ?? 0 })).sort((a, b) => b.score - a.score);
  const featuredId = upcoming[0]?.id ?? null, comingSoonId = upcoming[1]?.id ?? null;
  const liveCourses = rows.map((r) => {
    const key = String(r.id);
    return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: owned.has(key), purchaseCount: counts.get(key) ?? 0, cardVariant: key === featuredId ? "featured" : key === comingSoonId ? "coming_soon" : null, plans: splitPlansByMaterial(plans.get(r.id) ?? []) };
  });
  return { liveCourses, total, page: q.page, limit: q.limit };
};

// Newest active live courses (createdAt desc, not the listing's ordered-first sort),
// with the same plans / daysLeft / isPurchased contract as listClient so cards agree.
// No hero ranking.
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
  // Category tab bar from ws_package_category; unknown ids fall back to nulls. The
  // "All" count is the sum.
  const catRows = await repo.packageCategoriesByIds([...catCounts.keys()]);
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const categories = [...catCounts].map(([catId, count]) => {
    const c = catById.get(catId);
    return { _id: String(catId), title: c?.title ?? null, slug: c?.slug ?? null, image: c?.image ?? null, count };
  });
  const allCount = [...catCounts.values()].reduce((n, c) => n + c, 0);
  return { liveBatches, total, page: q.page, limit: q.limit, categories, allCount, selectedCategoryId: q.categoryId ? String(q.categoryId) : null };
};

// Courses the customer currently owns, with daysLeft and plans.
export const listMyCourses = async (customerId: number | null) => {
  if (!customerId) return { liveCourses: [], total: 0 };
  const ownedIds = await repo.ownedCourseIds(customerId, new Date());
  const [rows, daysLeft, plans] = await Promise.all([repo.coursesByIdsActive(ownedIds), getDaysLeftMap(customerId, ownedIds), plansGrouped(ownedIds)]);
  const liveCourses = rows.map((r) => { const key = String(r.id); return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: true, plans: plans.get(r.id) ?? [] }; });
  return { liveCourses, total: liveCourses.length };
};

/**
 * One row per physical session (repo dedupes shared sessions), carrying all linked
 * courses. Entitlement fields (`liveCourses[].isPurchased`, `subscribed`, `accessLevel`)
 * are resolved in two batched queries per page and are UI hints only; GET
 * /client/live-sessions/:id re-runs the real gate.
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
    // Owning any linked course is full access. A session with no linked course is
    // ungated, matching the detail endpoint.
    const subscribed = ids.length === 0 || liveCourses.some((c) => c.isPurchased);
    return {
      ...toSessionDto(s),
      sessionId: String(s.id),
      liveCourseIds: ids.map(String),
      liveCourses,
      subscribed,
      // Same numbers as the detail endpoint: full → 0, untouched trial → the whole
      // allowance, partly used → what is left (read-only).
      accessLevel: subscribed ? "full" : previewLevels.get(s.id)?.accessLevel ?? "preview",
      previewSecondsRemaining: subscribed ? 0 : previewLevels.get(s.id)?.previewSecondsRemaining ?? LIVE_PREVIEW_SECONDS,
    };
  });
  return { sessions, total, page, limit };
};

export const listAllUpcomingSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  // Discovery feed: upcoming sessions of every active course.
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

export const listSessionsForCourseClient = async (id: number, q: { status?: string; upcoming?: string; search?: string; page?: string; limit?: string }): Promise<"not_found" | { sessions: any[]; total: number; page: number; limit: number }> => {
  return listSessionsForCourse(id, q); // same shape as the admin sessions-for-course
};

export const getScheduleFolderForClient = async (id: number, folderId: string): Promise<"not_found" | "folder_not_found" | { scheduleFolder: any }> => {
  const row = await repo.findById(id);
  if (!row || !row.status) return "not_found";
  const folder = jArr(row.scheduleFolders).find((f: any) => String(f._id) === folderId);
  if (!folder) return "folder_not_found";
  return { scheduleFolder: { _id: folder._id, title: folder.title, image: folder.image ?? null, order: folder.order ?? 0, status: folder.status !== false, entries: [...(folder.entries ?? [])].sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0)) } };
};

// timetable = sessions with a scheduledAt (session educator from
// ws_live_session.educator_id, populated), scheduleFolders = the course's active
// folder JSON, plus daysLeft.
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

// For every owned live course, its active schedule folders + daysLeft. This is a
// home-screen navigation list and the nav DTO strips `entryCount`, so every row must
// lead somewhere: a folder counts only when visible (status !== false) and holding at
// least one entry. Empty folders are dropped, and a course with none is dropped.
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
  const liveCourses = courses
    .map((c) => {
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
        }))
        .filter((f) => f.entryCount > 0);
      const key = String(c.id);
      return {
        _id: String(c.id),
        name: c.name,
        image: c.image,
        scheduleFolders: folders,
        daysLeft: daysLeftMap.has(key) ? daysLeftMap.get(key) ?? null : null,
      };
    })
    // `totalLiveCourses` counts what is returned, so the FE's empty state fires on 0
    // instead of on courses that open nothing.
    .filter((c) => c.scheduleFolders.length > 0);
  return { liveCourses, totalLiveCourses: liveCourses.length };
};

// Live-course folder + video persistence (ws_video_category + ws_video). Videos have no
// live-session backlink column, so from-recording stores the mp4 path as aws_id +
// platform "aws" and dedupes per folder by (vcategory_id, aws_id).
import { prisma } from "../../config/prisma";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";


function lcSlugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// `_id` is the stringified int.
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

/** ws_live_course.video_category_id, or null. */
const lcRootFolderId = async (liveCourseId: number): Promise<number | null> => {
  const lc = await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { videoCategoryId: true } });
  return lc ? lc.videoCategoryId ?? null : null;
};

export const lcCourseExists = async (liveCourseId: number): Promise<boolean> =>
  !!(await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { id: true } }));

/** Folder ids reachable from the course root (inclusive). Empty if no root set. */
const lcReachableFolderIds = async (liveCourseId: number): Promise<number[]> => {
  const root = await lcRootFolderId(liveCourseId);
  if (!root) return [];
  return descendantsOf([root]);
};

/**
 * Keyed on the flat `live_course_id` column (not the root/DAG) so admin folder ops and
 * the client recordings reader (getRecordingsForClient) agree; lcCreateFolder stamps it
 * on every folder.
 */
export const lcFolderBelongsToCourse = async (folderId: number, liveCourseId: number): Promise<boolean> =>
  !!(await prisma.videoCategory.findFirst({ where: { id: folderId, liveCourseId }, select: { id: true } }));

/**
 * Every folder owned by the course (by liveCourseId) + relation rows. Optional
 * `search` filters by title (used by the admin folder picker).
 */
export const lcListFolders = async (
  liveCourseId: number,
  search?: string
): Promise<{ folders: any[]; relations: any[] }> => {
  const where: any = { liveCourseId };
  const titleSearch = buildPrismaPrefixSearch(search, ["title"]);
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

/** Inserts a relation row when parentFolderId is given. */
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
      // ws_video_category.parent is NOT NULL in the DB (0 = top-level) though the model
      // types it `Int?`; default to 0 to avoid a null-constraint error.
      parent: input.parentFolderId ?? 0,
      // Stamp the owning course so the recordings reader (filters by liveCourseId) sees it.
      liveCourseId,
      // educator_id is also NOT NULL (default 0) despite the `Int?` model type.
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

/** Returns the DTO, or null if the folder is not in this course. */
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
 * Refuses the course root folder. Cascades: the folder's videos and relations
 * referencing it, then the folder itself.
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

/** Ordered by `order` asc, DB-paginated; each row carries its global `order` so reorder is page-independent. */
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

/** Manual video (youtube/aws/vimeo). */
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

/** Picks a recording by quality → index → best quality. */
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
 * Picks a recording from the live session's recordings JSON by index/quality and
 * files its mp4 path into the folder as an aws video, deduped per folder by
 * (vcategory_id, aws_id).
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

/** Scoped to the folder. Returns whether a row was deleted. */
export const lcDeleteVideoInFolder = async (folderId: number, videoId: number): Promise<boolean> => {
  const res = await prisma.video.deleteMany({ where: { id: videoId, videoCategoryId: folderId } });
  return res.count > 0;
};

/** Returns the DTO, or null if not in this folder. */
export const lcGetVideoInFolder = async (folderId: number, videoId: number): Promise<any | null> => {
  const row = await prisma.video.findFirst({ where: { id: videoId, videoCategoryId: folderId }, select: lcVideoSelect });
  return row ? videoDto(row) : null;
};

/** Scoped to the folder. Returns the DTO or null (not found). */
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

/** Only videos in this folder are touched (other ids are ignored). Returns matched/modified. */
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
