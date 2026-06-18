import { isMysqlModule } from "../../config/migration";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import type { LiveCourse, LiveCoursePlan, LiveCourseSubscription, LiveSession } from "@prisma/client";

export const LIVE_COURSE_MODULE = "live-course";
export const isLiveCourseMysql = (): boolean => isMysqlModule(LIVE_COURSE_MODULE);

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
  isDefault: p.isDefault,
  status: p.status,
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
    originalPrice: v.originalPrice ?? null, isDefault: !!v.isDefault, status: v.status !== false,
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
  for (const k of ["name", "duration", "price", "originalPrice", "isDefault", "status"]) if (v[k] !== undefined) data[k] = v[k];
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
const toChatMessageDto = (m: any) => ({ _id: String(m.id), customerId: idStrOrNull(m.customerId), userName: m.userName ?? null, message: m.message ?? null, createdAt: m.createdAt ?? null });

export const getChatHistory = async (liveClassId: string, limit: number, before?: Date) => {
  const rows = await repo.chatHistory(liveClassId, limit, before);
  return rows.reverse().map(toChatMessageDto); // chrono order (Mongo reverses too)
};

export const getChatBanStatus = async (customerId: number) => {
  const ban = await repo.chatBanForCustomer(customerId);
  return ban ? { isBanned: true, reason: ban.reason ?? null, bannedAt: ban.createdAt ?? null } : { isBanned: false, reason: null, bannedAt: null };
};

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

export const listChatBans = async () => (await repo.listChatBans()).map((b) => ({ _id: String(b.id), liveClassId: b.liveClassId, customerId: idStrOrNull(b.customerId), reason: b.reason ?? null, createdAt: b.createdAt ?? null }));

export const banCustomerFromChat = async (liveClassId: string, customerId: number, bannedBy: number | null, reason: string | null): Promise<"already" | any> => {
  if (await repo.chatBanForCustomer(customerId)) return "already";
  const b = await repo.banCustomer(liveClassId, customerId, bannedBy, reason);
  return { _id: String(b.id), liveClassId: b.liveClassId, customerId: String(customerId), reason: b.reason ?? null, createdAt: b.createdAt };
};

export const unbanCustomerFromChat = async (customerId: number): Promise<boolean> => {
  const r = await repo.unbanCustomer(customerId);
  return r.count > 0;
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
    isDefault: p.isDefault, status: p.status,
  };
};

// ⚠ packageCategoryId is surfaced as the bare id (no Mongo populate — no SQL
// ws_package_category table). courseEducatorId likewise bare id.
const plansGrouped = async (courseIds: number[]) => {
  const plans = await repo.activePlansForCourses(courseIds);
  const byCourse = new Map<number, any[]>();
  for (const p of plans) { const a = byCourse.get(p.liveCourseId) ?? []; a.push(toClientPlan(p)); byCourse.set(p.liveCourseId, a); }
  return byCourse;
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
    return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: owned.has(key), purchaseCount: counts.get(key) ?? 0, cardVariant: key === featuredId ? "featured" : key === comingSoonId ? "coming_soon" : null, plans: plans.get(r.id) ?? [] };
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
  // ⚠ category tab bar: PackageCategory has no SQL table → emit id+count only
  // (no title/slug/image). The "All" count is the sum.
  const categories = [...catCounts].map(([catId, count]) => ({ _id: String(catId), title: null, slug: null, image: null, count }));
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
