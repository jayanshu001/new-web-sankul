// Live courses: admin course CRUD, ordering and pricing plans. Subscriptions live in live-course.subscription.service.
import { countPlanUsage, countPlanUsageOne } from "../../utils/planUsage";
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import { parseMaterialCategoryRefs } from "./admin-live-course.refs";
import type { LiveCourse, LiveCoursePlan } from "@prisma/client";
import { buildPagination } from "../../utils/listQuery";
import { nextOrder } from "../../utils/listOrdering";
import { idStrOrNull, jArr, parseLiveId, toSessionDto } from "./live-course.shared";

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
