import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import { adminAuthRepository } from "../admin-auth/admin-auth.repository";
import { deriveRole } from "../admin-auth/admin-auth.transformer";
import type { LiveCourse, LiveCoursePlan, LiveCourseSubscription, LiveSession } from "@prisma/client";
import { getVodStreamMeta } from "../../admin/live/streamos.service";
import { redisClient } from "../../config/redis";

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
  level: row.level ?? null,
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
  const created = await repo.create({
    name: v.name, subtitle: v.subtitle ?? null, description: v.description ?? null, image: v.image ?? null,
    ordered: v.ordered ?? 0, shareableLink: v.shareableLink ?? null, withMaterial: v.withMaterial ?? null,
    withoutMaterial: v.withoutMaterial ?? null, level: v.level ?? null, classType: v.classType ?? "live",
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
  if (v.level !== undefined) data.level = v.level;
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
export const listSessionsForCourse = async (id: number, q: { status?: string; upcoming?: string; page?: string; limit?: string }): Promise<"not_found" | { sessions: any[]; total: number; page: number; limit: number }> => {
  if (!(await repo.exists(id))) return "not_found";
  const page = Math.max(1, parseInt(q.page as any) || 1);
  const limit = Math.min(100, parseInt(q.limit as any) || 50);
  const { rows, total } = await repo.sessionsForCourse(id, {
    status: typeof q.status === "string" ? q.status : undefined,
    upcoming: q.upcoming === "true", now: new Date(), skip: (page - 1) * limit, take: limit,
  });
  return { sessions: rows.map(toSessionDto), total, page, limit };
};

// ── plans ──────────────────────────────────────────────────────────────────────
export const listPlans = async (liveCourseId: number): Promise<any[]> => (await repo.listPlans(liveCourseId)).map(toPlanDto);

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

export const listSubscriptions = async (q: { liveCourseId?: string; customerId?: string; planId?: string; paymentStatus?: string; status?: string; page?: string; limit?: string }): Promise<"bad_course" | "bad_customer" | { subscriptions: any[]; total: number; page: number; limit: number }> => {
  const page = Math.max(1, parseInt(q.page as any) || 1);
  const limit = Math.min(100, parseInt(q.limit as any) || 20);
  let liveCourseId: number | undefined, customerId: number | undefined, planId: number | undefined;
  if (q.liveCourseId) { liveCourseId = parseLiveId(q.liveCourseId) ?? undefined; if (!liveCourseId) return "bad_course"; }
  if (q.customerId) { customerId = parseLiveId(q.customerId) ?? undefined; if (!customerId) return "bad_customer"; }
  if (q.planId) planId = parseLiveId(q.planId) ?? undefined;
  const opts = {
    liveCourseId, customerId, planId,
    paymentStatus: ["pending", "verified", "failed"].includes(q.paymentStatus as any) ? q.paymentStatus : undefined,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listSubscriptions({ ...opts, skip: (page - 1) * limit, take: limit }),
    repo.countSubscriptions(opts),
  ]);
  return { subscriptions: await hydrateSubs(rows), total, page, limit };
};

export const getSubscription = async (id: number): Promise<"not_found" | any> => {
  const row = await repo.findSubscriptionById(id);
  if (!row) return "not_found";
  return (await hydrateSubs([row]))[0];
};

export const grantSubscription = async (liveCourseId: number, v: { customerId: string; planId: string; durationDays?: number; durationMonths?: number; startAt?: string; endAt?: string }): Promise<{ ok: false; code: string; msg: string } | { ok: true; created: boolean; data: any }> => {
  if (!(await repo.exists(liveCourseId))) return { ok: false, code: "course", msg: "Live course not found." };
  const customerId = parseLiveId(v.customerId);
  const planId = parseLiveId(v.planId);
  if (!customerId || !(await repo.customerExists(customerId))) return { ok: false, code: "customer", msg: "Customer not found." };
  const plan = planId ? await repo.findPlanById(planId) : null;
  if (!plan) return { ok: false, code: "plan", msg: "Plan not found." };
  if (plan.liveCourseId !== liveCourseId) return { ok: false, code: "mismatch", msg: "Plan does not belong to this live course." };

  const now = new Date();
  let startAt = now;
  if (v.startAt) { const dt = new Date(v.startAt); if (isNaN(dt.getTime())) return { ok: false, code: "startAt", msg: "startAt must be a valid date." }; startAt = dt; }
  // plan.duration is DAYS (per the live-course controllers' computeEndAt asDays).
  let endAt: Date;
  if (v.endAt) { const dt = new Date(v.endAt); if (isNaN(dt.getTime())) return { ok: false, code: "endAt", msg: "endAt must be a valid date." }; endAt = dt; }
  else if (v.durationDays != null) endAt = computeEndAt({ startAt, durationMonths: v.durationDays, asDays: true });
  else if (v.durationMonths != null) endAt = computeEndAt({ startAt, durationMonths: v.durationMonths });
  else endAt = computeEndAt({ startAt, durationMonths: plan.duration, asDays: true });
  if (endAt.getTime() <= startAt.getTime()) return { ok: false, code: "window", msg: "endAt must be after startAt." };

  const existing = (v.startAt || v.endAt) ? null : await repo.findActiveSubscription(customerId, liveCourseId, now);
  if (existing) {
    const newEnd = v.durationDays != null
      ? extendEndAt({ currentEndAt: existing.endAt, durationMonths: v.durationDays, asDays: true, now })
      : v.durationMonths != null
        ? extendEndAt({ currentEndAt: existing.endAt, durationMonths: v.durationMonths, now })
        : extendEndAt({ currentEndAt: existing.endAt, durationMonths: plan.duration, asDays: true, now });
    const updated = await repo.updateSubscription(existing.id, { endAt: newEnd, planId, paidAt: now });
    return { ok: true, created: false, data: (await hydrateSubs([updated]))[0] };
  }
  const sub = await repo.createSubscription({
    customerId, liveCourseId, planId, startAt, endAt, status: true, paidAmount: 0, paymentStatus: "verified", paidAt: now,
    createdAt: now, updatedAt: now,
  });
  return { ok: true, created: true, data: (await hydrateSubs([sub]))[0] };
};

export const updateSubscription = async (id: number, v: { status?: boolean; paymentStatus?: string; startAt?: string; endAt?: string }): Promise<"not_found" | "bad_start" | "bad_end" | any> => {
  if (!(await repo.findSubscriptionById(id))) return "not_found";
  const data: any = { updatedAt: new Date() };
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

export const listScheduleEntries = async (id: number, folderId: string): Promise<"not_found" | "folder_not_found" | { entries: any[] }> => {
  const r = await loadFolder(id, folderId);
  if (typeof r === "string") return r;
  return { entries: [...(r.folder.entries ?? [])].sort(sortByOrder) };
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
  if (!row || !row.status) return "not_found";

  const [educator, pkgCat, plansRaw, subscribed, daysLeftMap] = await Promise.all([
    row.educatorId != null ? repo.findEducator(row.educatorId) : Promise.resolve(null),
    row.packageCategoryId != null ? repo.findPackageCategory(row.packageCategoryId) : Promise.resolve(null),
    repo.listPlans(id),
    hasAccessToAnyLiveCourse(customerId, [id]),
    getDaysLeftMap(customerId, [id]),
  ]);

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
  baseUrl?: string
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
            _id: String(c.id), name: c.name, image: c.image, level: c.level, isPaid: c.isPaid, status: c.status,
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
  return { liveCourses, total: liveCourses.length };
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
  customerId: number | null
): Promise<"not_found" | any> => {
  const course = await repo.findById(courseId);
  if (!course || !course.status) return "not_found";

  const folders = await prisma.videoCategory.findMany({
    where: { liveCourseId: courseId, status: true },
    orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    select: { id: true, title: true, image: true, order_by: true },
  });
  const folderIds = folders.map((f) => f.id);
  const videos = folderIds.length
    ? await prisma.video.findMany({ where: { videoCategoryId: { in: folderIds }, status: true }, orderBy: [{ order: "asc" }, { created_at: "asc" }] })
    : [];

  const [subscribed, daysLeftMap] = await Promise.all([
    hasAccessToAnyLiveCourse(customerId, [courseId]),
    getDaysLeftMap(customerId, [courseId]),
  ]);
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
    // Prefer StreamOS VOD-meta-resolved URLs (actually playable); fall back to the
    // stored webhook recordings when the meta resolution is empty/unavailable.
    const vod = v.liveSessionId ? vodBySession.get(v.liveSessionId) ?? null : null;
    const storedHls = v.liveSessionId ? recBySession.get(v.liveSessionId) ?? [] : [];
    const storedMp4 = v.liveSessionId ? mp4BySession.get(v.liveSessionId) ?? [] : [];
    const hlsList = vod?.hls?.length ? vod.hls : storedHls;
    const mp4List = vod?.mp4?.length ? vod.mp4 : storedMp4;
    const hlsMasterUrl = vod?.hlsUrl ?? null;
    const mp4Url = pickBestMp4(mp4List);
    // `recordings` is the PRIMARY playback array = plain MP4 (un-DRM'd, simple
    // <video>/MP4). The DRM-HLS m3u8 ladder lives in `hlsRecordings`. `qualities`
    // is still derived from the HLS ladder (the true per-quality set). When a
    // session has no MP4, `recordings` is empty — the client falls back to
    // `hlsRecordings`. `mp4Recordings`/`mp4Url` are kept as explicit aliases.
    return {
      _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, order: v.order,
      locked: !canPlay, youtube_id: v.youtube_id ?? null, aws_id: sanitizeRecPath(v.aws_id ?? null), vimeo_id: v.vimeo_id ?? null,
      recordings: mp4List,
      hlsRecordings: hlsList,
      // Master adaptive HLS playlist (from VOD meta) — a single URL a player can
      // load directly; null when only the stored webhook ladder is available.
      hlsUrl: hlsMasterUrl,
      qualities: qualitiesFromSessionRecordings(hlsList),
      mp4Recordings: mp4List, mp4Url,
      progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
    };
  };

  const folderPayload = folders.map((f) => ({
    folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
    lectures: (byFolder.get(f.id) ?? []).map(shapeLecture),
  }));

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    subscribed, daysLeft, totalLectures: videos.length, folders: folderPayload,
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
  limit: number
): Promise<"not_found" | { liveCourse: any; subscribed: boolean; total: number; page: number; limit: number; lectures: any[] }> => {
  const course = await repo.findById(courseId);
  if (!course || !course.status) return "not_found";

  const links = await prisma.liveSessionCourse.findMany({ where: { liveCourseId: courseId }, select: { liveSessionId: true } });
  const sessionIds = [...new Set(links.map((l) => l.liveSessionId).filter((n): n is number => n != null))];
  const where = { id: { in: sessionIds.length ? sessionIds : [-1] }, status: { in: ["SCHEDULED", "CREATED"] } };
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
export type LivePreviewStateSql = { accessLevel: "full" | "preview" | "preview_ended"; previewExpiresAt: Date | null; previewSecondsRemaining: number };
export const resolveLivePreviewStateSql = async (
  customerId: number | null,
  liveSessionId: number,
  liveCourseIds: number[],
  track: boolean
): Promise<LivePreviewStateSql> => {
  if (!liveCourseIds.length) return { accessLevel: "full", previewExpiresAt: null, previewSecondsRemaining: 0 };
  if (await hasAccessToAnyLiveCourse(customerId, liveCourseIds)) return { accessLevel: "full", previewExpiresAt: null, previewSecondsRemaining: 0 };
  if (!track || !customerId) return { accessLevel: "preview", previewExpiresAt: null, previewSecondsRemaining: 0 };
  const now = new Date();
  let preview = await prisma.liveSessionPreview.findFirst({ where: { customerId, liveSessionId } });
  if (!preview) {
    try { preview = await prisma.liveSessionPreview.create({ data: { customerId, liveSessionId, startedAt: now, createdAt: now } }); }
    catch { preview = await prisma.liveSessionPreview.findFirst({ where: { customerId, liveSessionId } }); }
  }
  if (!preview?.startedAt) return { accessLevel: "preview", previewExpiresAt: null, previewSecondsRemaining: 0 };
  const expires = new Date(preview.startedAt.getTime() + LIVE_PREVIEW_SECONDS * 1000);
  if (now.getTime() >= expires.getTime()) return { accessLevel: "preview_ended", previewExpiresAt: expires, previewSecondsRemaining: 0 };
  return { accessLevel: "preview", previewExpiresAt: expires, previewSecondsRemaining: Math.ceil((expires.getTime() - now.getTime()) / 1000) };
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
export const listRecentLiveCourses = async (customerId: number | null, q: { page: number; limit: number }) => {
  const where = { status: true } as const;
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
const sessionFeed = async (courseIds: number[], mode: "upcoming" | "liveNow", page: number, limit: number) => {
  const { rows, total, courseBySession } = await repo.sessionsForCourses(courseIds, { upcoming: mode === "upcoming", liveNow: mode === "liveNow", now: new Date(), skip: (page - 1) * limit, take: limit });
  const sessions = rows.map((s) => ({ ...toSessionDto(s), liveCourseIds: (courseBySession.get(s.id) ?? []).map(String) }));
  return { sessions, total, page, limit };
};

export const listAllUpcomingSessions = async (q: { page: number; limit: number }) => {
  // All visible courses' upcoming sessions (discovery feed) — every active course.
  const all = await repo.listClientCourses({ now: new Date(), sort: "ordered", skip: 0, take: 1000 });
  return sessionFeed(all.map((c) => c.id), "upcoming", q.page, q.limit);
};

export const listLiveNowSessions = async (q: { page: number; limit: number }) => {
  const all = await repo.listClientCourses({ now: new Date(), sort: "ordered", skip: 0, take: 1000 });
  return sessionFeed(all.map((c) => c.id), "liveNow", q.page, q.limit);
};

export const listMyUpcomingSessions = async (customerId: number | null, q: { page: number; limit: number }) => {
  if (!customerId) return { sessions: [], total: 0, page: q.page, limit: q.limit };
  const owned = await repo.ownedCourseIds(customerId, new Date());
  return sessionFeed(owned, "upcoming", q.page, q.limit);
};

// ── sessions for one course (client) ──────────────────────────────────────────
export const listSessionsForCourseClient = async (id: number, q: { status?: string; upcoming?: string; page?: string; limit?: string }): Promise<"not_found" | { sessions: any[]; total: number; page: number; limit: number }> => {
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
      select: { id: true, name: true, image: true, level: true, scheduleFolders: true },
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
      level: c.level,
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
  const term = search?.trim();
  if (term) where.title = { contains: term };
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
/** listVideosInFolder: all videos in a folder, ordered. */
export const lcListVideosInFolder = async (folderId: number): Promise<any[]> => {
  const rows = await prisma.video.findMany({
    where: { videoCategoryId: folderId },
    orderBy: [{ order: "asc" }, { created_at: "asc" }],
    select: lcVideoSelect,
  });
  return rows.map(videoDto);
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
