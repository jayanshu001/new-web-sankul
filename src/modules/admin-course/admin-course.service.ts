import { adminCourseRepository as repo } from "./admin-course.repository";
import { nextOrder } from "../../utils/listOrdering";
import { prisma } from "../../config/prisma";
import { parseIdArray, populateExamCountdowns } from "../exam-countdown/exam-countdown.service";
import { buildPagination } from "../../utils/listQuery";
import { countPlanUsage, countPlanUsageOne } from "../../utils/planUsage";
import type { Course } from "@prisma/client";

export const ADMIN_COURSE_MODULE = "admin-course";
export const isAdminCourseMysql = (): boolean => true;

export const parseCourseId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStrOrNull = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);

// SQL enum → Mongo bool (mirrors catalog-course.transformer).
const toIsPopular = (v: Course["is_featured"]): boolean => v === "yes";
const toIsPaid = (v: Course["purchase"]): boolean => v !== "no";

type CourseRow = Course & {
  educator?: { id: number; name: string | null } | null;
  subject?: { id: number; title: string } | null;
  VideoCategory?: { id: number; title: string } | null;
};

const nameRef = (r: { id: number; name: string | null } | null | undefined) => (r ? { _id: String(r.id), name: r.name ?? "" } : null);
const titleRef = (r: { id: number; title: string } | null | undefined) => (r ? { _id: String(r.id), title: r.title } : null);

/** `ws_course` row (+ refs) → Mongo-shaped Course doc (populated refs replace scalar ids). */
const toCourseDto = (
  row: CourseRow,
  materialCats: any[],
  examCats: any[],
  ec?: { examCountdownIds: any[]; examCountdownCategoryIds: any[] }
) => ({
  _id: String(row.id),
  name: row.name ?? null,
  description: row.description,
  image: row.image ?? null,
  shareableLink: row.shareableLink,
  withMaterial: row.withMaterial,
  withoutMaterial: row.withoutMaterial,
  level: row.level,
  ordered: row.ordered,
  status: row.status,
  isPopular: toIsPopular(row.is_featured),
  isPaid: toIsPaid(row.purchase),
  courseEducatorId: nameRef(row.educator) ?? idStrOrNull(row.courseEducatorId),
  courseSubjectCategoryId: titleRef(row.subject) ?? idStrOrNull(row.courseSubjectCategoryId),
  videoCategoryId: titleRef(row.VideoCategory) ?? idStrOrNull(row.videoCategoryId),
  pcMaterialId: idStrOrNull(row.pcMaterialId),
  // Mongo embedded arrays → from the SQL pivot tables. category populated:
  // material → {_id,title,image}; exam → {_id,name,image}.
  materialCategories: materialCats.map((m) => ({
    category: m.MaterialCategory ? { _id: String(m.MaterialCategory.id), title: m.MaterialCategory.name, image: m.MaterialCategory.image ?? null } : idStrOrNull(m.materialCategoryId),
    order: m.order,
  })),
  examCategories: examCats.map((e) => ({
    category: e.ExamCategory ? { _id: String(e.ExamCategory.id), name: e.ExamCategory.name ?? null, image: e.ExamCategory.image ?? null } : idStrOrNull(e.examCategoryId),
    order: e.order,
  })),
  // C6: embedded examCountdown attachments, populated to the Mongo shape.
  examCountdownIds: ec?.examCountdownIds ?? [],
  examCountdownCategoryIds: ec?.examCountdownCategoryIds ?? [],
  // Legacy single-category field (first populated category or null).
  examCountdownCategoryId: ec?.examCountdownCategoryIds?.[0] ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const toPlanDto = (p: any) => ({
  id: String(p.id),
  name: p.name ?? null,
  duration: p.duration,
  price: p.price,
  withMaterial: p.withMaterial,
  materialPrice: p.materialPrice ?? 0,
  isDefault: p.isDefault,
  status: p.status,
  isMostPopular: p.isMostPopular ?? false, // computed, read-only (plan-popularity)
  courseId: idStrOrNull(p.courseId),
  createdAt: p.created_at ?? null,
  updatedAt: p.updated_at ?? null,
});

// ── pre-requisites ───────────────────────────────────────────────────────────
export const getPreRequisites = async () => {
  const [educators, subjectCategories, videoCategories, materials] = await Promise.all([
    repo.activeEducators(), repo.activeSubjectCategories(), repo.activeVideoCategories(), repo.allMaterials(),
  ]);
  return {
    educators: educators.map((e) => ({ _id: String(e.id), name: e.name })),
    subjectCategories: subjectCategories.map((s) => ({ _id: String(s.id), name: s.title })),
    videoCategories: videoCategories.map((v) => ({ _id: String(v.id), name: v.title })),
    materials: materials.map((m) => ({ _id: String(m.id), name: m.title })),
  };
};

// ── list / detail ──────────────────────────────────────────────────────────────
export interface ListCoursesQuery { search?: string; status?: string; isPaid?: string; isPopular?: string; page?: string; limit?: string; sortBy?: string; sortOrder?: string }

export const listCourses = async (q: ListCoursesQuery) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "10", 10) || 10, 1), 100);
  const opts = {
    search: q.search,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
    isPaid: q.isPaid === "true" ? true : q.isPaid === "false" ? false : undefined,
    isPopular: q.isPopular === "true" ? true : q.isPopular === "false" ? false : undefined,
    sortBy: q.sortBy ?? "createdAt",
    sortDir: (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (pageNum - 1) * limitNum, take: limitNum }),
    repo.count(opts),
  ]);
  // Hydrate each course's category pivots.
  const data = await Promise.all(rows.map(async (row) => {
    const [mc, ec] = await Promise.all([repo.materialCategoriesFor(row.id), repo.examCategoriesFor(row.id)]);
    return toCourseDto(row, mc, ec);
  }));
  return { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const getCourseById = async (id: number): Promise<"not_found" | { course: any; plans: any[] }> => {
  const [row, mc, ec, plans] = await Promise.all([
    repo.findById(id), repo.materialCategoriesFor(id), repo.examCategoriesFor(id), repo.listPlans(id),
  ]);
  if (!row) return "not_found";
  // C6: populate the row's stored examCountdown JSON columns to Mongo shape.
  const countdowns = await populateExamCountdowns(row as any);
  return { course: toCourseDto(row, mc, ec, countdowns), plans: plans.map(toPlanDto) };
};

// ── course write ────────────────────────────────────────────────────────────
// ws_course NOT-NULL no-default columns get write-time sentinels.
export interface CourseWriteInput {
  name?: string; description?: string; image?: string; ordered?: number; shareableLink?: string;
  withMaterial?: string; withoutMaterial?: string; level?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean;
  courseEducatorId?: number; courseSubjectCategoryId?: number; videoCategoryId?: number;
  // Physical-material kit FK (ws_course.pc_material_id). null detaches.
  pcMaterialId?: number | null;
  materialCategories?: Array<{ category: number; order: number }>;
  examCategories?: Array<{ category: number; order: number }>;
  // C6: embedded examCountdown attachments — stored as JSON int[] on ws_course.
  examCountdownIds?: any;
  examCountdownCategoryIds?: any;
}

const pivotRows = (refs?: Array<{ category: number; order: number }>) =>
  (refs ?? []).map((r) => ({ categoryId: r.category, order: r.order }));

export const createCourse = async (d: CourseWriteInput) => {
  const now = new Date();
  // No explicit order → previous row + 1 (see utils/listOrdering).
  const courseOrder = d.ordered ?? nextOrder((await prisma.course.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { ordered: true } }))?.ordered);
  const course = await repo.createCourse({
    data: {
      name: d.name ?? null,
      description: d.description ?? "",
      image: d.image ?? null,
      ordered: courseOrder,
      shareableLink: d.shareableLink ?? "",
      withMaterial: d.withMaterial ?? "0",
      withoutMaterial: d.withoutMaterial ?? "0",
      level: d.level ?? "1",
      // course_category_id / educator_id are NOT NULL → 0 sentinel when unset.
      courseSubjectCategoryId: d.courseSubjectCategoryId ?? 0,
      courseEducatorId: d.courseEducatorId ?? 0,
      videoCategoryId: d.videoCategoryId ?? null,
      pcMaterialId: d.pcMaterialId ?? null,
      purchase: d.isPaid === false ? "no" : "yes",
      is_featured: d.isPopular ? "yes" : "no",
      status: d.status ?? true,
      // C6: embedded examCountdown attachments → JSON int[] columns.
      examCountdownIds: parseIdArray(d.examCountdownIds),
      examCountdownCategoryIds: parseIdArray(d.examCountdownCategoryIds),
      createdAt: now, updatedAt: now,
    },
    materialCategories: pivotRows(d.materialCategories),
    examCategories: pivotRows(d.examCategories),
  });
  const detail = await getCourseById(course.id);
  // The Mongo path returns { course, folder }; folder is the Root VideoCategory
  // automation, which is NOT representable on SQL (no course_id col) → null.
  return { course: detail === "not_found" ? null : detail.course, folder: null };
};

export const updateCourse = async (id: number, d: CourseWriteInput): Promise<"not_found" | any> => {
  if (!(await repo.exists(id))) return "not_found";
  const data: any = { updatedAt: new Date() };
  if (d.name !== undefined) data.name = d.name;
  if (d.description !== undefined) data.description = d.description ?? "";
  if (d.image !== undefined) data.image = d.image;
  if (d.ordered !== undefined) data.ordered = d.ordered;
  if (d.shareableLink !== undefined) data.shareableLink = d.shareableLink ?? "";
  if (d.withMaterial !== undefined) data.withMaterial = d.withMaterial;
  if (d.withoutMaterial !== undefined) data.withoutMaterial = d.withoutMaterial;
  if (d.level !== undefined) data.level = d.level;
  if (d.courseSubjectCategoryId !== undefined) data.courseSubjectCategoryId = d.courseSubjectCategoryId;
  if (d.courseEducatorId !== undefined) data.courseEducatorId = d.courseEducatorId;
  if (d.videoCategoryId !== undefined) data.videoCategoryId = d.videoCategoryId;
  if (d.pcMaterialId !== undefined) data.pcMaterialId = d.pcMaterialId;
  if (d.isPaid !== undefined) data.purchase = d.isPaid === false ? "no" : "yes";
  if (d.isPopular !== undefined) data.is_featured = d.isPopular ? "yes" : "no";
  if (d.status !== undefined) data.status = d.status;
  // C6: embedded examCountdown attachments → JSON int[] columns.
  if (d.examCountdownIds !== undefined) data.examCountdownIds = parseIdArray(d.examCountdownIds);
  if (d.examCountdownCategoryIds !== undefined) data.examCountdownCategoryIds = parseIdArray(d.examCountdownCategoryIds);

  await repo.updateCourse(id, data, {
    materialCategories: d.materialCategories !== undefined ? pivotRows(d.materialCategories) : undefined,
    examCategories: d.examCategories !== undefined ? pivotRows(d.examCategories) : undefined,
  });
  const detail = await getCourseById(id);
  return detail === "not_found" ? "not_found" : detail.course;
};

export const deleteCourse = async (id: number): Promise<"not_found" | { deletedCourseId: string; deletedPlans: number; deletedCourseVideoCategories: number; deletedVideoRelations: number }> => {
  if (!(await repo.exists(id))) return "not_found";
  const { deletedPlans } = await repo.deleteCourse(id);
  // courseId-scoped folder/relation cleanup is N/A on SQL (no course_id col).
  return { deletedCourseId: String(id), deletedPlans, deletedCourseVideoCategories: 0, deletedVideoRelations: 0 };
};

export const toggleCoursePopular = async (id: number, requested?: boolean | string): Promise<"not_found" | { _id: string; isPopular: boolean }> => {
  const course = await repo.findBare(id);
  if (!course) return "not_found";
  const current = toIsPopular(course.is_featured);
  let next: boolean;
  if (typeof requested === "boolean") next = requested;
  else if (requested === "true" || requested === "false") next = requested === "true";
  else next = !current;
  await repo.setPopular(id, next);
  return { _id: String(id), isPopular: next };
};

// Toggle status (ws_course.status). Flips the current value; an explicit
// boolean/"true"/"false" in the body sets it directly. No required-field checks
// (unlike the full update) so a status flip never trips e.g. courseEducatorId.
export const toggleCourseStatus = async (id: number, requested?: boolean | string): Promise<"not_found" | { _id: string; status: boolean }> => {
  const course = await repo.findBare(id);
  if (!course) return "not_found";
  let next: boolean;
  if (typeof requested === "boolean") next = requested;
  else if (requested === "true" || requested === "false") next = requested === "true";
  else next = !course.status;
  await repo.setStatus(id, next);
  return { _id: String(id), status: next };
};

// ── plans ──────────────────────────────────────────────────────────────────────
export const listCoursePlans = async (
  courseId: number,
  opts: { skip: number; take: number; page: number; limit: number }
): Promise<"not_found" | { data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const [rows, total] = await Promise.all([
    repo.listPlans(courseId, opts.skip, opts.take),
    repo.countPlans(courseId),
  ]);
  // `orderCount` drives the panel's Delete lock (all-time, status-blind) — one
  // grouped query for the page, never one per row. Always a number: absent means
  // "unknown" to the FE, which then leaves Delete enabled.
  const usage = await countPlanUsage("price", rows.map((r) => r.id));
  return {
    data: rows.map((r) => ({ ...toPlanDto(r), orderCount: usage.get(r.id) ?? 0 })),
    pagination: buildPagination(total, opts.page, opts.limit),
  };
};

// ── course-detail category tabs (paginated, resolved rows) ──────────────────────
// Flatten each pivot row to { _id, name, image, status, order }, resolving the
// linked category so the admin UI drops its client-side name lookup. `_id` is the
// category id; `order` is the course-specific pivot order.
const examCatRowDto = (e: {
  order: number; examCategoryId: number | null;
  ExamCategory: { id: number; name: string | null; image: string | null; status: boolean } | null;
}) => ({
  _id: e.ExamCategory ? String(e.ExamCategory.id) : e.examCategoryId != null ? String(e.examCategoryId) : null,
  name: e.ExamCategory?.name ?? null,
  image: e.ExamCategory?.image ?? null,
  status: e.ExamCategory?.status ?? null,
  order: e.order,
});
const materialCatRowDto = (m: {
  order: number; materialCategoryId: number | null;
  MaterialCategory: { id: number; name: string | null; image: string | null; status: boolean } | null;
}) => ({
  _id: m.MaterialCategory ? String(m.MaterialCategory.id) : m.materialCategoryId != null ? String(m.materialCategoryId) : null,
  name: m.MaterialCategory?.name ?? null,
  image: m.MaterialCategory?.image ?? null,
  status: m.MaterialCategory?.status ?? null,
  order: m.order,
});

export const listCourseExamCategories = async (
  courseId: number,
  opts: { skip: number; take: number; page: number; limit: number; search?: string }
): Promise<"not_found" | { data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const [rows, total] = await Promise.all([
    repo.examCategoriesForPaged(courseId, { skip: opts.skip, take: opts.take, search: opts.search }),
    repo.countExamCategoriesFor(courseId, opts.search),
  ]);
  return { data: rows.map(examCatRowDto), pagination: buildPagination(total, opts.page, opts.limit) };
};

export const listCourseMaterialCategories = async (
  courseId: number,
  opts: { skip: number; take: number; page: number; limit: number; search?: string }
): Promise<"not_found" | { data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const [rows, total] = await Promise.all([
    repo.materialCategoriesForPaged(courseId, { skip: opts.skip, take: opts.take, search: opts.search }),
    repo.countMaterialCategoriesFor(courseId, opts.search),
  ]);
  return { data: rows.map(materialCatRowDto), pagination: buildPagination(total, opts.page, opts.limit) };
};

// Course-Detail "Material (Book)" row. Shape matches the admin book-row renderer
// (same as the Package → Books tab). `orderBy` is the per-course pivot order.
const courseBookRowDto = (r: {
  order: number; bookId: number | null;
  Book: {
    id: number; name: string; author: string | null; image: string | null; thumbnail: string | null;
    list_price: number; discounted_price: number; language: string;
    is_magazine: boolean; isCombo: boolean; isTrending: boolean; active: boolean;
  } | null;
}) => ({
  _id: r.Book ? String(r.Book.id) : r.bookId != null ? String(r.bookId) : null,
  name: r.Book?.name ?? null,
  author: r.Book?.author ?? null,
  image: r.Book?.image ?? null,
  thumbnail: r.Book?.thumbnail ?? null,
  listPrice: r.Book?.list_price ?? null,
  discountedPrice: r.Book?.discounted_price ?? null,
  language: r.Book?.language ?? null,
  isMagazine: r.Book?.is_magazine ?? null,
  isCombo: r.Book?.isCombo ?? null,
  isTrending: r.Book?.isTrending ?? null,
  status: r.Book?.active ?? null,
  orderBy: r.order,
});

export const listCourseBooks = async (
  courseId: number,
  opts: { skip: number; take: number; page: number; limit: number; search?: string }
): Promise<"not_found" | { data: any[]; pagination: ReturnType<typeof buildPagination> }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const [rows, total] = await Promise.all([
    repo.booksForPaged(courseId, { skip: opts.skip, take: opts.take, search: opts.search }),
    repo.countBooksFor(courseId, opts.search),
  ]);
  return { data: rows.map(courseBookRowDto), pagination: buildPagination(total, opts.page, opts.limit) };
};

// Attach books to a course. Skips ids already linked and ids that don't exist;
// new links append after the current max per-course order. Idempotent.
export const linkCourseBooks = async (
  courseId: number,
  bookIds: number[]
): Promise<"not_found" | { added: number; skipped: number; invalid: number[] }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const uniqueIds = [...new Set(bookIds)];
  const existing = new Set((await repo.existingBookIds(uniqueIds)).map((b) => b.id));
  const invalid = uniqueIds.filter((id) => !existing.has(id));
  const validIds = uniqueIds.filter((id) => existing.has(id));
  const alreadyLinked = new Set((await repo.linkedBookIds(courseId, validIds)).map((r) => r.bookId));
  const toAdd = validIds.filter((id) => !alreadyLinked.has(id));

  if (toAdd.length) {
    const now = new Date();
    let order = await repo.maxBookOrder(courseId);
    const rows = toAdd.map((bookId) => ({ courseId, bookId, order: ++order, created_at: now, updated_at: now }));
    await repo.createBookLinks(rows);
  }
  return { added: toAdd.length, skipped: validIds.length - toAdd.length, invalid };
};

export const reorderCourseBooks = async (
  courseId: number,
  items: { bookId: number; order: number }[]
): Promise<"not_found" | { updated: number }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  await repo.reorderBookLinks(courseId, items, new Date());
  return { updated: items.length };
};

export const reorderCourseExamCategories = async (
  courseId: number,
  items: { categoryId: number; order: number }[]
): Promise<"not_found" | { updated: number }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  await repo.reorderExamCategoryLinks(courseId, items, new Date());
  return { updated: items.length };
};

export const reorderCourseMaterialCategories = async (
  courseId: number,
  items: { categoryId: number; order: number }[]
): Promise<"not_found" | { updated: number }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  await repo.reorderMaterialCategoryLinks(courseId, items, new Date());
  return { updated: items.length };
};

export const unlinkCourseBook = async (
  courseId: number,
  bookId: number
): Promise<"not_found" | "link_not_found" | { removed: true }> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const res = await repo.unlinkBook(courseId, bookId);
  if (res.count === 0) return "link_not_found";
  return { removed: true };
};

export const createCoursePlan = async (courseId: number, validated: any): Promise<"not_found" | any> => {
  if (!(await repo.exists(courseId))) return "not_found";
  const duration = validated.duration ?? validated.subscriptionDurationMonths;
  const now = new Date();
  const created = await repo.createPlan({
    courseId, packageId: 0, ebookId: 0,
    name: validated.name ?? null,
    duration,
    price: validated.price,
    withMaterial: validated.withMaterial ?? false,
    materialPrice: validated.materialPrice ?? 0,
    isDefault: validated.isDefault ?? false,
    status: validated.status ?? true,
    created_at: now, updated_at: now,
  });
  if (created.isDefault) await repo.clearSiblingDefaults(courseId, created.id);
  return toPlanDto(created);
};

export const getCoursePlanById = async (planId: number): Promise<"not_found" | any> => {
  const plan = await repo.findPlanById(planId);
  return plan ? toPlanDto(plan) : "not_found";
};

/**
 * A saved plan's COMMERCIAL terms are immutable (product rule, 2026-08-21) — a
 * wrong price is corrected by adding a new plan and deactivating the old one, not
 * by rewriting what buyers already paid. Only `name`, `status` and the editorial
 * `isDefault` flag stay writable; everything else is dropped rather than 422'd, so
 * a form that still re-sends the stored values on save is not broken by the rule.
 */
export const updateCoursePlan = async (planId: number, validated: any): Promise<"not_found" | "frozen_terms" | any> => {
  const existing = await repo.findPlanById(planId);
  if (!existing) return "not_found";

  // Reject only a payload that would actually CHANGE a frozen term; a no-op
  // re-send of the stored values passes untouched.
  const duration = validated.duration ?? validated.subscriptionDurationMonths;
  const changesFrozen =
    (duration !== undefined && duration !== existing.duration) ||
    (validated.price !== undefined && validated.price !== existing.price) ||
    (validated.withMaterial !== undefined && validated.withMaterial !== existing.withMaterial) ||
    (validated.materialPrice !== undefined && (validated.materialPrice ?? 0) !== (existing.materialPrice ?? 0));
  if (changesFrozen) return "frozen_terms";

  const data: any = { updated_at: new Date() };
  if (validated.name !== undefined) data.name = validated.name;
  if (validated.isDefault !== undefined) data.isDefault = validated.isDefault;
  if (validated.status !== undefined) data.status = validated.status;
  const updated = await repo.updatePlan(planId, data);
  if (updated.isDefault && updated.courseId) await repo.clearSiblingDefaults(updated.courseId, updated.id);
  return toPlanDto(updated);
};

export const deleteCoursePlan = async (planId: number): Promise<"not_found" | { inUse: number } | true> => {
  if (!(await repo.findPlanById(planId))) return "not_found";
  // One ordered row — of any status, expired or not — pins the plan for good.
  // ws_package_course_subscription has no FK on pcb_id, so without this the
  // delete succeeds and leaves those rows pointing at a plan that is gone.
  const inUse = await countPlanUsageOne("price", planId);
  if (inUse > 0) return { inUse };
  await repo.deletePromotedForPlan(planId);
  await repo.deletePlan(planId);
  return true;
};

// ── video categories (global ws_video_category; courseId dropped) ───────────────
const toVideoCategoryDto = (v: any) => ({
  _id: String(v.id),
  title: v.title,
  slug: v.slug,
  image: v.image,
  // courseId has no SQL column — Mongo-only; surfaced null for shape-compat.
  courseId: null,
  order_by: v.order_by,
  status: v.status,
  createdAt: v.created_at ?? null,
  updatedAt: v.updated_at ?? null,
});

export const listCourseVideoCategories = async (q: { page?: string; limit?: string }) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
  const [rows, total] = await Promise.all([
    repo.listVideoCategories({ skip: (pageNum - 1) * limitNum, take: limitNum }),
    repo.countVideoCategories(),
  ]);
  return { data: rows.map(toVideoCategoryDto), pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const createCourseVideoCategory = async (validated: any) => {
  const now = new Date();
  const created = await repo.createVideoCategory({
    title: validated.title, slug: validated.slug, image: validated.image,
    // courseId dropped (no column); parent/educator_id/pdf default per admin-master.
    parent: 0, educatorId: 0, pdf: "",
    order_by: validated.order_by ?? 0,
    status: validated.status ?? true,
    created_at: now, updated_at: now,
  });
  return toVideoCategoryDto(created);
};

export const updateCourseVideoCategory = async (id: number, validated: any): Promise<"not_found" | any> => {
  if (!(await repo.findVideoCategoryBare(id))) return "not_found";
  const data: any = { updated_at: new Date() };
  if (validated.title !== undefined) data.title = validated.title;
  if (validated.slug !== undefined) data.slug = validated.slug;
  if (validated.image !== undefined && validated.image !== null) data.image = validated.image;
  if (validated.order_by !== undefined) data.order_by = validated.order_by;
  if (validated.status !== undefined) data.status = validated.status;
  const updated = await repo.updateVideoCategory(id, data);
  return toVideoCategoryDto(updated);
};

export const deleteCourseVideoCategory = async (id: number): Promise<"not_found" | "in_use" | { deletedRelations: number }> => {
  if (await repo.videoCategoryUsedByCourse(id)) return "in_use";
  if (!(await repo.findVideoCategoryBare(id))) return "not_found";
  await repo.deleteVideoCategory(id);
  const rel = await repo.deleteRelationsForCategory(id);
  return { deletedRelations: rel.count };
};

// ── materials (pc-material; title-only) ─────────────────────────────────────────
const toMaterialDto = (m: any) => ({ _id: String(m.id), title: m.title, createdAt: m.created_at ?? null, updatedAt: m.updated_at ?? null });

export const listCourseMaterials = async (q: { page?: string; limit?: string }) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
  const [rows, total] = await Promise.all([
    repo.listMaterials({ skip: (pageNum - 1) * limitNum, take: limitNum }),
    repo.countMaterials(),
  ]);
  return { data: rows.map(toMaterialDto), pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const createCourseMaterial = async (validated: any) => {
  const now = new Date();
  // ws_package_course_material is TITLE-ONLY (image/isActive dropped — admin-master).
  const created = await repo.createMaterial({ title: validated.title, created_at: now, updated_at: now });
  return toMaterialDto(created);
};

export const updateCourseMaterial = async (id: number, validated: any): Promise<"not_found" | any> => {
  if (!(await repo.findMaterialBare(id))) return "not_found";
  const data: any = { updated_at: new Date() };
  if (validated.title !== undefined) data.title = validated.title;
  const updated = await repo.updateMaterial(id, data);
  return toMaterialDto(updated);
};

export const deleteCourseMaterial = async (id: number): Promise<boolean> => {
  if (!(await repo.findMaterialBare(id))) return false;
  await repo.deleteMaterial(id);
  return true;
};

// ── video category relations ─────────────────────────────────────────────────
const toRelationDto = (r: any) => ({
  _id: String(r.id),
  parent: String(r.parent),
  // Only the child FK is a real relation in Prisma; parent is a bare int.
  child: r.childVideoCategory ? { _id: String(r.childVideoCategory.id), title: r.childVideoCategory.title, slug: r.childVideoCategory.slug } : String(r.child),
  order: r.order,
});

export const listVideoCategoryRelations = async (q: { page?: string; limit?: string }) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
  const [rows, total] = await Promise.all([
    repo.listRelations({ skip: (pageNum - 1) * limitNum, take: limitNum }),
    repo.countRelations(),
  ]);
  return { data: rows.map(toRelationDto), pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const createVideoCategoryRelation = async (input: { parent?: string; child?: string; order?: number }): Promise<"missing" | "same" | "not_found" | "exists" | any> => {
  const parent = parseCourseId(String(input.parent ?? ""));
  const child = parseCourseId(String(input.child ?? ""));
  if (!input.parent || !input.child) return "missing";
  if (!parent || !child) return "not_found";
  if (parent === child) return "same";
  const [p, c] = await Promise.all([repo.findVideoCategoryBare(parent), repo.findVideoCategoryBare(child)]);
  if (!p || !c) return "not_found";
  if (await repo.relationExists(parent, child)) return "exists";
  const created = await repo.createRelation({ parent, child, order: input.order ?? 0 });
  return { _id: String(created.id), parent: String(created.parent), child: String(created.child), order: created.order };
};

export const updateVideoCategoryRelation = async (id: number, order: number): Promise<"not_found" | any> => {
  if (!(await repo.findRelationBare(id))) return "not_found";
  const updated = await repo.updateRelation(id, order);
  return { _id: String(updated.id), parent: String(updated.parent), child: String(updated.child), order: updated.order };
};

export const deleteVideoCategoryRelation = async (id: number): Promise<boolean> => {
  if (!(await repo.findRelationBare(id))) return false;
  await repo.deleteRelation(id);
  return true;
};
