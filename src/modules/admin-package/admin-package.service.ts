// Admin packages: package/type CRUD, category tabs, plans, subscribers and video relations.
import { HttpError } from "../../middlewares/errorHandler";
import { countPlanUsage, countPlanUsageOne } from "../../utils/planUsage";
import { nextOrder } from "../../utils/listOrdering";
import { prisma } from "../../config/prisma";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminPackageRepository as repo } from "./admin-package.repository";
import { resyncPackageRelations } from "./package-relation-sync";
import { parseLabels } from "../../utils/goalSelection";
import type { Package, PackageType } from "@prisma/client";
import { parsePositiveInt } from "../../utils/parseId";
import { parseListQuery } from "../../utils/listQuery";


export const parsePackageId = parsePositiveInt;

const idStrOrNull = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);

// string[] (numeric ids) → int[] for the JSON countdown columns; drops non-numerics.
const toIntIdArray = (arr?: string[]): number[] =>
  (arr ?? []).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
// JSON int[] column → string[] for the DTO.
const jsonIdsToStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : [];

// goalLabelId is the label NAME at the API boundary; ws_package.goal_label_id stores
// the JSON-label numeric id. name → id on write, id → name on read.
const labelNameById = (labels: unknown, labelId: number | null | undefined): string | null => {
  if (labelId == null) return null;
  const arr = Array.isArray(labels) ? labels : [];
  const hit = arr.find((l: any) => Number(l?.id) === labelId);
  return hit ? String((hit as any).name) : null;
};
const labelIdByName = (labels: unknown, name: string): number | null => {
  const arr = Array.isArray(labels) ? labels : [];
  const hit = arr.find((l: any) => l?.name === name);
  return hit && (hit as any).id != null ? Number((hit as any).id) : null;
};

/**
 * Resolve + validate a (goalId, goalLabelName) pair for writes: when a label name is
 * supplied, goalId is required and the name must exist under that goal, else the
 * contract reject string. Returns the numeric ids to persist (and the canonical name).
 */
const resolveGoalFields = async (
  goalIdStr: string | null | undefined,
  goalLabelName: string | null | undefined
): Promise<{ goalId: number | null; goalLabelId: number | null; goalLabelName: string | null; isIndividual: boolean }> => {
  const goalId = goalIdStr ? parsePackageId(goalIdStr) : null;
  if (!goalId) {
    // A label without a goal is invalid.
    if (goalLabelName) throw new HttpError(400, "goalId is required when goalLabelId is provided.");
    return { goalId: null, goalLabelId: null, goalLabelName: null, isIndividual: false };
  }
  const goal = await repo.goalById(goalId);
  if (!goal) throw new HttpError(404, "Goal not found for the supplied goalId.");

  // Goal-driven rule: goal WITH labels → label required (label-based, is_individual=0);
  // goal with NO labels → label must be omitted (individual/goal-level, is_individual=1).
  const hasLabels = parseLabels(goal.labels).length > 0;
  if (hasLabels) {
    if (!goalLabelName) throw new HttpError(400, "goalLabelId is required for this goal.");
    const labelId = labelIdByName(goal.labels, goalLabelName);
    if (labelId == null) throw new HttpError(400, "goalLabelId does not belong to the supplied goalId.");
    return { goalId, goalLabelId: labelId, goalLabelName, isIndividual: false };
  }
  if (goalLabelName) throw new HttpError(400, "This goal has no labels; goalLabelId must be omitted.");
  return { goalId, goalLabelId: null, goalLabelName: null, isIndividual: true };
};

/** Resolve a persisted row's goal_label_id (int) → label name for the response DTO. */
const resolveLabelNameForRow = async (row: { goalId?: number | null; goalLabelId?: number | null }): Promise<string | null> => {
  if (row.goalLabelId == null || row.goalId == null) return null;
  const goal = await repo.goalById(row.goalId);
  return labelNameById(goal?.labels, row.goalLabelId);
};

const toTypeDto = (t: PackageType) => ({ _id: String(t.id), name: t.name, createdAt: t.created_at ?? null, updatedAt: t.updated_at ?? null });

type PkgRow = Package & { packageType?: { id: number; name: string } | null };

/**
 * `ws_package` row → Package DTO. packageCategoryId is a bare id string (not populated).
 * examCountdownCategoryIds/examCountdownIds come from JSON columns as id strings.
 * subtitle/notificationTopic have no column → "". goalId is the numeric id as a string
 * (unpopulated); goalLabelId is the label NAME, resolved by the caller (`goalLabelName`).
 */
const toPackageDto = (
  row: PkgRow,
  embeds?: { specificSubjects: any[]; materialCategories: any[]; examCategories: any[] },
  goalLabelName?: string | null
) => ({
  _id: String(row.id),
  name: row.name,
  subtitle: "",
  description: row.description,
  image: row.image || null,
  shareableLink: row.shareable_link ?? null,
  withMaterialText: row.withMaterial,
  withoutMaterialText: row.withoutMaterial,
  order: row.order_by,
  active: row.active,
  isPaid: row.isPaid,
  isPopular: row.isPopular ?? false,
  packageTypeId: row.packageType ? { _id: String(row.packageType.id), name: row.packageType.name } : idStrOrNull(row.packageTypeId),
  goalId: idStrOrNull(row.goalId),
  goalLabelId: goalLabelName ?? null,
  isIndividual: row.isIndividual ?? false,
  examCountdownCategoryIds: jsonIdsToStrings(row.examCountdownCategoryIds),
  examCountdownIds: jsonIdsToStrings(row.examCountdownIds),
  packageCategoryId: idStrOrNull(row.packageCategoryId),
  educatorId: idStrOrNull(row.educator_id),
  pcMaterialId: idStrOrNull(row.pcMaterialId),
  notificationTopic: "",
  ...(embeds ?? {}),
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

const toPlanDto = (p: any) => ({
  _id: String(p.id),
  packageId: idStrOrNull(p.packageId),
  name: p.name ?? null,
  duration: p.duration,
  price: p.price,
  withMaterial: p.withMaterial,
  materialPrice: p.materialPrice ?? 0,
  isDefault: p.isDefault,
  status: p.status,
  isMostPopular: p.isMostPopular ?? false, // computed, read-only (plan-popularity)
  createdAt: p.created_at ?? null,
  updatedAt: p.updated_at ?? null,
});

// Embedded category ref → { category: {_id,title|name,image}, order, status }.
const subjectRef = (r: any) => ({
  category: r.VideoCategory ? { _id: String(r.VideoCategory.id), title: r.VideoCategory.title, image: r.VideoCategory.image ?? null } : idStrOrNull(r.subjectId),
  order: r.order_by, status: r.status,
});
const materialRef = (r: any) => ({
  category: r.MaterialCategory ? { _id: String(r.MaterialCategory.id), title: r.MaterialCategory.name, image: r.MaterialCategory.image ?? null } : idStrOrNull(r.materialCategoryId),
  order: r.order, status: true,
});
const examRef = (r: any) => ({
  category: r.ExamCategory ? { _id: String(r.ExamCategory.id), title: r.ExamCategory.name ?? null, image: r.ExamCategory.image ?? null } : idStrOrNull(r.examCategoryId),
  order: r.order, status: true,
});

const loadEmbeds = async (packageId: number) => {
  const [ss, mc, ec] = await Promise.all([repo.specificSubjectsFor(packageId), repo.materialCategoriesFor(packageId), repo.examCategoriesFor(packageId)]);
  return { specificSubjects: ss.map(subjectRef), materialCategories: mc.map(materialRef), examCategories: ec.map(examRef) };
};

// Paginated-tab rows = the embedded ref shape + a flattened `categoryName` so the
// admin UI can render/sort without re-resolving the ref.
const subjectRowDto = (r: any) => ({ ...subjectRef(r), categoryName: r.VideoCategory?.title ?? null });
const materialRowDto = (r: any) => ({ ...materialRef(r), categoryName: r.MaterialCategory?.name ?? null });
const examRowDto = (r: any) => ({ ...examRef(r), categoryName: r.ExamCategory?.name ?? null });

// Shared page/limit parse, mirroring listSubscribers (default 20, cap 100).
const pageArgs = (q: { page?: string; limit?: string }) => {
  const { page, limit } = parseListQuery({ page: q.page, limit: q.limit }, { defaultLimit: 20, maxLimit: 100 });
  return { page, limit, skip: (page - 1) * limit };
};
const pageMeta = (total: number, page: number, limit: number) => ({ total, page, limit, totalPages: Math.ceil(total / limit) });

export const listSpecificSubjects = async (packageId: number, q: { page?: string; limit?: string }): Promise<"not_found" | { data: any[]; pagination: any }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const { page, limit, skip } = pageArgs(q);
  const [rows, total] = await Promise.all([repo.specificSubjectsForPaged(packageId, skip, limit), repo.countSpecificSubjectsFor(packageId)]);
  return { data: rows.map(subjectRowDto), pagination: pageMeta(total, page, limit) };
};

export const listMaterialCategories = async (packageId: number, q: { page?: string; limit?: string }): Promise<"not_found" | { data: any[]; pagination: any }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const { page, limit, skip } = pageArgs(q);
  const [rows, total] = await Promise.all([repo.materialCategoriesForPaged(packageId, skip, limit), repo.countMaterialCategoriesFor(packageId)]);
  return { data: rows.map(materialRowDto), pagination: pageMeta(total, page, limit) };
};

export const listExamCategories = async (packageId: number, q: { page?: string; limit?: string }): Promise<"not_found" | { data: any[]; pagination: any }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const { page, limit, skip } = pageArgs(q);
  const [rows, total] = await Promise.all([repo.examCategoriesForPaged(packageId, skip, limit), repo.countExamCategoriesFor(packageId)]);
  return { data: rows.map(examRowDto), pagination: pageMeta(total, page, limit) };
};

export const listPackageTypes = async () => (await repo.listTypes()).map(toTypeDto);

export const createPackageType = async (d: { name: string }) => {
  const now = new Date();
  // ws_package_type has only id/name (+ timestamps).
  return toTypeDto(await repo.createType({ name: d.name, created_at: now, updated_at: now }));
};

export const updatePackageType = async (id: number, d: { name?: string }): Promise<"not_found" | any> => {
  if (!(await repo.findTypeBare(id))) return "not_found";
  const data: any = { updated_at: new Date() };
  if (d.name !== undefined) data.name = d.name;
  return toTypeDto(await repo.updateType(id, data));
};

export const deletePackageType = async (id: number): Promise<"not_found" | "in_use" | true> => {
  if (!(await repo.findTypeBare(id))) return "not_found";
  if (await repo.typeInUse(id)) return "in_use";
  await repo.deleteType(id);
  return true;
};

export interface ListPackagesQuery { search?: string; active?: string; isPaid?: string; packageTypeId?: string; goalId?: string; page?: string; limit?: string }

// Paged list; each row carries its active plans split by withMaterial.
export const listPackages = async (q: ListPackagesQuery) => {
  const { page: pageNum, limit: limitNum } = parseListQuery({ page: q.page, limit: q.limit }, { defaultLimit: 20, maxLimit: 100 });
  // isPaid/goalId query filters are accepted but ignored.
  const opts = {
    search: q.search,
    active: q.active === "true" ? true : q.active === "false" ? false : undefined,
    packageTypeId: q.packageTypeId ? parsePackageId(q.packageTypeId) ?? undefined : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (pageNum - 1) * limitNum, take: limitNum }),
    repo.count(opts),
  ]);
  // Attach active plans split into withMaterial/withoutMaterial (list-row pricing).
  const plans = await repo.plansForPackages(rows.map((p) => p.id));
  const byPkg = new Map<number, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of plans as any[]) {
    if (p.packageId == null) continue;
    let bucket = byPkg.get(p.packageId);
    if (!bucket) { bucket = { withMaterial: [], withoutMaterial: [] }; byPkg.set(p.packageId, bucket); }
    (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(toPlanDto(p));
  }
  // Resolve each row's goal_label_id → label name (batch-load the referenced goals).
  const goalIds = [...new Set(rows.map((r) => r.goalId).filter((g): g is number => g != null))];
  const goals = await repo.goalsByIds(goalIds);
  const labelsByGoal = new Map<number, unknown>(goals.map((g) => [g.id, g.labels]));
  const data = rows.map((row) => ({
    ...toPackageDto(row, undefined, labelNameById(labelsByGoal.get(row.goalId as number), row.goalLabelId)),
    plans: byPkg.get(row.id) ?? { withMaterial: [], withoutMaterial: [] },
  }));
  return { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const getPackageById = async (id: number): Promise<"not_found" | any> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";
  return toPackageDto(row, await loadEmbeds(id), await resolveLabelNameForRow(row));
};

export interface PackageWriteInput {
  name?: string; subtitle?: string; description?: string; image?: string; shareableLink?: string;
  withMaterialText?: string; withoutMaterialText?: string; order?: number; active?: boolean;
  packageTypeId?: string | null; educatorId?: string | null;
  goalId?: string | null; goalLabelId?: string | null; // goalLabelId = label NAME
  isPaid?: boolean;
  isPopular?: boolean;
  packageCategoryId?: string | null;
  // Physical-material kit id (ws_package.pc_material_id). null detaches.
  pcMaterialId?: string | null;
  examCountdownCategoryIds?: string[]; examCountdownIds?: string[];
  specificSubjects?: Array<{ category: string; order?: number; status?: boolean }>;
  materialCategories?: Array<{ category: string; order?: number }>;
  examCategories?: Array<{ category: string; order?: number }>;
}

// packageTypeId (string id, or null/"" to clear) → int column value. A non-numeric or
// non-existent id throws a 4xx so callers never fall back to a wrong type (or hit an FK 500).
const resolvePackageTypeId = async (raw?: string | null): Promise<number | null> => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parsePackageId(raw);
  if (!n) throw Object.assign(new Error("Invalid package type id."), { statusCode: 400 });
  if (!(await repo.findTypeBare(n))) throw Object.assign(new Error("Package type not found."), { statusCode: 404 });
  return n;
};

const subjectRows = (refs?: Array<{ category: string; order?: number; status?: boolean }>) =>
  (refs ?? []).map((r) => ({ id: Number(r.category), order: r.order ?? 0, status: r.status ?? true })).filter((r) => Number.isInteger(r.id) && r.id > 0);
const catRows = (refs?: Array<{ category: string; order?: number }>) =>
  (refs ?? []).map((r) => ({ id: Number(r.category), order: r.order ?? 0 })).filter((r) => Number.isInteger(r.id) && r.id > 0);

export const createPackage = async (d: PackageWriteInput) => {
  const now = new Date();
  // No explicit order → previous row + 1 (see utils/listOrdering).
  const pkgOrder = d.order ?? nextOrder((await prisma.package.findFirst({ orderBy: [{ created_at: "desc" }, { id: "desc" }], select: { order_by: true } }))?.order_by);
  const gf = await resolveGoalFields(d.goalId, d.goalLabelId);
  const pkg = await repo.createPackage({
    data: {
      name: d.name ?? "",
      description: d.description ?? "",
      image: d.image ?? "",
      shareable_link: d.shareableLink ?? null,
      withMaterial: d.withMaterialText ?? "",
      withoutMaterial: d.withoutMaterialText ?? "",
      order_by: pkgOrder,
      active: d.active ?? true,
      // package_type_id is nullable; null clears it. exam_id NOT NULL → sentinel 0.
      packageTypeId: await resolvePackageTypeId(d.packageTypeId),
      examId: 0,
      educator_id: d.educatorId ? parsePackageId(d.educatorId) : null,
      goalId: gf.goalId,
      goalLabelId: gf.goalLabelId,
      isIndividual: gf.isIndividual,
      isPaid: d.isPaid ?? true,
      isPopular: d.isPopular ?? false,
      packageCategoryId: d.packageCategoryId ? parsePackageId(d.packageCategoryId) : null,
      pcMaterialId: d.pcMaterialId ? parsePackageId(d.pcMaterialId) ?? null : null,
      examCountdownCategoryIds: toIntIdArray(d.examCountdownCategoryIds),
      examCountdownIds: toIntIdArray(d.examCountdownIds),
      created_at: now, updated_at: now,
    },
    specificSubjects: subjectRows(d.specificSubjects),
    materialCategories: catRows(d.materialCategories),
    examCategories: catRows(d.examCategories),
  });
  // Sync the denormalized video-category↔package relation from the new subjects.
  await resyncPackageRelations([pkg.id]);
  return toPackageDto(await repo.findById(pkg.id) as PkgRow, await loadEmbeds(pkg.id), gf.goalLabelName);
};

// Partial update; revalidates goal/label and resyncs video relations when subjects change.
export const updatePackage = async (id: number, d: PackageWriteInput): Promise<"not_found" | any> => {
  const existing = await repo.findBare(id);
  if (!existing) return "not_found";
  const data: any = { updated_at: new Date() };
  if (d.name !== undefined) data.name = d.name;
  if (d.description !== undefined) data.description = d.description ?? "";
  if (d.image !== undefined) data.image = d.image ?? "";
  if (d.shareableLink !== undefined) data.shareable_link = d.shareableLink ?? null;
  if (d.withMaterialText !== undefined) data.withMaterial = d.withMaterialText ?? "";
  if (d.withoutMaterialText !== undefined) data.withoutMaterial = d.withoutMaterialText ?? "";
  if (d.order !== undefined) data.order_by = d.order;
  if (d.active !== undefined) data.active = d.active;
  if (d.packageTypeId !== undefined) data.packageTypeId = await resolvePackageTypeId(d.packageTypeId);
  if (d.educatorId !== undefined) data.educator_id = d.educatorId ? parsePackageId(d.educatorId) : null;
  if (d.isPaid !== undefined) data.isPaid = d.isPaid;
  if (d.isPopular !== undefined) data.isPopular = d.isPopular;
  if (d.packageCategoryId !== undefined) data.packageCategoryId = d.packageCategoryId ? parsePackageId(d.packageCategoryId) : null;
  if (d.pcMaterialId !== undefined) data.pcMaterialId = d.pcMaterialId ? parsePackageId(d.pcMaterialId) ?? null : null;
  if (d.examCountdownCategoryIds !== undefined) data.examCountdownCategoryIds = toIntIdArray(d.examCountdownCategoryIds);
  if (d.examCountdownIds !== undefined) data.examCountdownIds = toIntIdArray(d.examCountdownIds);

  // Goal/label: validate the merged (goalId, labelName) pair when either is supplied,
  // then persist both numeric ids.
  if (d.goalId !== undefined || d.goalLabelId !== undefined) {
    const nextGoalIdStr = d.goalId !== undefined ? (d.goalId || null) : idStrOrNull(existing.goalId);
    let nextLabelName: string | null;
    if (d.goalLabelId !== undefined) {
      nextLabelName = d.goalLabelId || null;
    } else if (existing.goalLabelId != null) {
      const exGoal = existing.goalId != null ? await repo.goalById(existing.goalId) : null;
      nextLabelName = labelNameById(exGoal?.labels, existing.goalLabelId);
    } else {
      nextLabelName = null;
    }
    const gf = await resolveGoalFields(nextGoalIdStr, nextLabelName);
    data.goalId = gf.goalId;
    data.goalLabelId = gf.goalLabelId;
    data.isIndividual = gf.isIndividual;
  }

  await repo.updatePackage(id, data, {
    specificSubjects: d.specificSubjects !== undefined ? subjectRows(d.specificSubjects) : undefined,
    materialCategories: d.materialCategories !== undefined ? catRows(d.materialCategories) : undefined,
    examCategories: d.examCategories !== undefined ? catRows(d.examCategories) : undefined,
  });
  // Subjects changed → recompute this package's video-category relation rows.
  if (d.specificSubjects !== undefined) await resyncPackageRelations([id]);
  const row = (await repo.findById(id)) as PkgRow;
  return toPackageDto(row, await loadEmbeds(id), await resolveLabelNameForRow(row));
};

// Refuses while the package has subscribers; its plans are detached, not deleted.
export const deletePackage = async (id: number): Promise<"not_found" | "has_subscribers" | true> => {
  if (!(await repo.exists(id))) return "not_found";
  if ((await repo.subscriberCount(id)) > 0) return "has_subscribers";
  await repo.deletePackage(id);
  return true;
};

export const togglePackageStatus = async (id: number): Promise<"not_found" | { active: boolean }> => {
  const pkg = await repo.findBare(id);
  if (!pkg) return "not_found";
  const updated = await repo.setActive(id, !pkg.active);
  return { active: updated.active };
};

export const reorderPackages = async (orders: Array<{ id: string; order: number }>): Promise<"dup" | true> => {
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) return "dup";
  await Promise.all(orders.map(({ id, order }) => {
    const n = parsePackageId(id);
    return n ? repo.setOrder(n, order) : Promise.resolve();
  }));
  return true;
};

// Reorder one category tab; returns that tab's refreshed embed array.
export const reorderEmbedded = async (
  pkgId: number,
  field: "specificSubjects" | "materialCategories" | "examCategories",
  orders: Array<{ category: string; order: number }>
): Promise<"not_found" | "dup" | any> => {
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) return "dup";
  if (!(await repo.exists(pkgId))) return "not_found";
  const rows = orders
    .map(({ category, order }) => ({ categoryId: parsePackageId(category), order }))
    .filter((r): r is { categoryId: number; order: number } => r.categoryId != null);
  if (rows.length) {
    if (field === "specificSubjects") await repo.reorderSpecificSubjects(pkgId, rows);
    else if (field === "materialCategories") await repo.reorderMaterialCategories(pkgId, rows);
    else await repo.reorderExamCategories(pkgId, rows);
  }
  const embeds = await loadEmbeds(pkgId);
  return embeds[field];
};

export const listPackagePlans = async (
  packageId: number,
  q: { page?: string; limit?: string; status?: string }
): Promise<"not_found" | { data: any[]; pagination: any }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const { page: pageNum, limit: limitNum } = parseListQuery({ page: q.page, limit: q.limit }, { defaultLimit: 10, maxLimit: 500 });
  // Optional status filter; absent (the panel's case) = all plans. Anything other than
  // the two literals is ignored rather than 422'd — a typo must not empty the tab.
  const status = q.status === "true" ? true : q.status === "false" ? false : undefined;
  const [rows, total] = await Promise.all([
    repo.listPlans(packageId, (pageNum - 1) * limitNum, limitNum, status),
    repo.countPlans(packageId, status),
  ]);
  // `orderCount` (all-time, status-blind) drives the Delete lock. `subscriberCount` is
  // kept beside it: the panel reads `orderCount ?? subscriberCount`, and they are not
  // synonyms (orderCount also counts orders with no subscription row yet).
  const [counts, usage] = await Promise.all([
    rows.length ? repo.subscriptionCountsByPlan(rows.map((r) => r.id)) : Promise.resolve([]),
    countPlanUsage("price", rows.map((r) => r.id)),
  ]);
  const countByPlan = new Map(counts.map((c: any) => [c.planId, c._count?._all ?? 0]));
  return {
    data: rows.map((r) => ({
      ...toPlanDto(r),
      subscriberCount: countByPlan.get(r.id) ?? 0,
      orderCount: usage.get(r.id) ?? 0,
    })),
    pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  };
};

// Move plans onto this package (clears their course/ebook owner).
export const attachPlansToPackage = async (packageId: number, planIds: string[]): Promise<"not_found" | "no_valid" | { modified: number }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const ids = planIds.map((i) => parsePackageId(i)).filter((n): n is number => n != null);
  if (!ids.length) return "no_valid";
  const r = await repo.attachPlans(packageId, ids);
  return { modified: r.count };
};

/** Delete a plan from a package — a real delete, guarded like the other four modules. */
export const detachPlan = async (
  packageId: number,
  planId: number
): Promise<"not_found" | { inUse: number } | true> => {
  if (!(await repo.findPlanInPackage(packageId, planId))) return "not_found";
  const inUse = await countPlanUsageOne("price", planId);
  if (inUse > 0) return { inUse };
  await repo.deletePromotedForPlan(planId);
  await repo.deletePlanFromPackage(packageId, planId);
  return true;
};

export const listSubscribers = async (packageId: number, q: { page?: string; limit?: string }): Promise<"not_found" | { data: any[]; pagination: any }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const { page: pageNum, limit: limitNum } = parseListQuery({ page: q.page, limit: q.limit }, { defaultLimit: 20, maxLimit: 100 });
  const [rows, total] = await Promise.all([
    repo.listSubscribers(packageId, (pageNum - 1) * limitNum, limitNum),
    repo.countSubscribers(packageId),
  ]);
  const data = rows.map((s: any) => {
    const c = s.customer;
    const { firstName, lastName } = splitFullName(c?.fullName);
    return {
      _id: String(s.id),
      customerId: c ? { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber, emailAddress: c.emailAddress ?? null } : null,
      packageId: s.package ? { _id: String(s.package.id), name: s.package.name } : idStrOrNull(s.packageId),
      // `amount` is the canonical paid value; `paid_amount` is promoter-only and NULL for
      // everyone else (see admin-customer-details.transformer).
      paidAmount: s.amount != null ? Number(s.amount) : null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      status: s.status ?? null,
      createdAt: s.createdAt ?? null,
    };
  });
  return { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const listVideoRelations = async (packageId: number): Promise<"not_found" | any[]> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const rows = await repo.listVideoRelations(packageId);
  return rows.map((r) => ({ _id: String(r.id), packageId: String(r.packageId), videoCategoryRelationId: String(r.videoCategoryRelationId), active: r.status }));
};

export const setVideoRelations = async (packageId: number, relationIds: string[]): Promise<"not_found" | { count: number }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const ids = relationIds.map((i) => parsePackageId(i)).filter((n): n is number => n != null);
  const count = await repo.setVideoRelations(packageId, ids);
  return { count };
};

/** BFS across VideoCategoryRelation from the package's specificSubjects roots. */
export const expandSubjectsToRelations = async (packageId: number): Promise<"not_found" | { count: number }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const roots = await repo.specificSubjectIds(packageId);
  const collected = new Set<number>();
  let frontier = [...roots];
  while (frontier.length) {
    const rels = await repo.relationsByParents(frontier);
    if (!rels.length) break;
    const next: number[] = [];
    for (const r of rels) {
      if (!collected.has(r.id)) { collected.add(r.id); if (r.child != null) next.push(r.child); }
    }
    frontier = next;
  }
  const count = await repo.setVideoRelations(packageId, [...collected]);
  return { count };
};
