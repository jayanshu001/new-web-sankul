import { isMysqlModule } from "../../config/migration";
import { HttpError } from "../../middlewares/errorHandler";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminPackageRepository as repo } from "./admin-package.repository";
import type { Package, PackageType } from "@prisma/client";

export const ADMIN_PACKAGE_MODULE = "admin-package";
export const isAdminPackageMysql = (): boolean => isMysqlModule(ADMIN_PACKAGE_MODULE);

export const parsePackageId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStrOrNull = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);

// ── goal-label resolution ──────────────────────────────────────────────────────
// goalLabelId is the label NAME at the API boundary (labels carry no usable id
// in Mongo); SQL stores the JSON-label numeric id in ws_package.goal_label_id.
// These bridge the two: name → id on write, id → name on read.
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
 * Resolve + validate a (goalId, goalLabelName) pair for writes. Mirrors the Mongo
 * `assertGoalLabelPair`: when a label name is supplied, goalId is required and the
 * name MUST exist under that goal — else the contract reject string. Returns the
 * numeric ids to persist (and the canonical name for the response DTO).
 */
const resolveGoalFields = async (
  goalIdStr: string | null | undefined,
  goalLabelName: string | null | undefined
): Promise<{ goalId: number | null; goalLabelId: number | null; goalLabelName: string | null }> => {
  const goalId = goalIdStr ? parsePackageId(goalIdStr) : null;
  if (!goalLabelName) return { goalId, goalLabelId: null, goalLabelName: null };
  if (!goalId) throw new HttpError(400, "goalId is required when goalLabelId is provided.");
  const goal = await repo.goalById(goalId);
  if (!goal) throw new HttpError(404, "Goal not found for the supplied goalId.");
  const labelId = labelIdByName(goal.labels, goalLabelName);
  if (labelId == null) throw new HttpError(400, "goalLabelId does not belong to the supplied goalId.");
  return { goalId, goalLabelId: labelId, goalLabelName };
};

/** Resolve a persisted row's goal_label_id (int) → label name for the response DTO. */
const resolveLabelNameForRow = async (row: { goalId?: number | null; goalLabelId?: number | null }): Promise<string | null> => {
  if (row.goalLabelId == null || row.goalId == null) return null;
  const goal = await repo.goalById(row.goalId);
  return labelNameById(goal?.labels, row.goalLabelId);
};

// ── transformers ─────────────────────────────────────────────────────────────
const toTypeDto = (t: PackageType) => ({ _id: String(t.id), name: t.name, createdAt: t.created_at ?? null, updatedAt: t.updated_at ?? null });

type PkgRow = Package & { packageType?: { id: number; name: string } | null };

/**
 * `ws_package` row → Mongo-shaped Package doc. SQL-absent fields synthesized:
 * isPaid=true (Mongo default), isSmartCourse/isPlannerCourse=false, subtitle="",
 * notificationTopic="", packageCategoryId=null, examCountdown*=[]. goalId is the
 * numeric id as a string (unpopulated, mirroring Mongo); goalLabelId is the label
 * NAME string (resolved by the caller, passed in as `goalLabelName`).
 * with_material/without_material are the descriptive *Text fields in Mongo.
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
  isPaid: true,
  isSmartCourse: false,
  isPlannerCourse: false,
  packageTypeId: row.packageType ? { _id: String(row.packageType.id), name: row.packageType.name } : idStrOrNull(row.packageTypeId),
  goalId: idStrOrNull(row.goalId),
  goalLabelId: goalLabelName ?? null,
  examCountdownCategoryIds: [],
  examCountdownIds: [],
  packageCategoryId: null,
  educatorId: idStrOrNull(row.educator_id),
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
  createdAt: p.created_at ?? null,
  updatedAt: p.updated_at ?? null,
});

// Embedded category ref → Mongo shape: { category: {_id,title|name,image}, order, status }.
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

// ── package types ──────────────────────────────────────────────────────────────
export const listPackageTypes = async () => (await repo.listTypes()).map(toTypeDto);

export const createPackageType = async (d: { name: string }) => {
  const now = new Date();
  // ws_package_type has only id/name (+ timestamps) — order/active dropped.
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

// ── packages: list / get ────────────────────────────────────────────────────────
export interface ListPackagesQuery { search?: string; active?: string; isPaid?: string; packageTypeId?: string; goalId?: string; page?: string; limit?: string }

export const listPackages = async (q: ListPackagesQuery) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "20", 10) || 20, 1), 100);
  // isPaid/goalId filters are Mongo-only (no SQL columns) → ignored on SQL.
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

// ── packages: write ───────────────────────────────────────────────────────────
export interface PackageWriteInput {
  name?: string; subtitle?: string; description?: string; image?: string; shareableLink?: string;
  withMaterialText?: string; withoutMaterialText?: string; order?: number; active?: boolean;
  packageTypeId?: string | null; educatorId?: string | null;
  goalId?: string | null; goalLabelId?: string | null; // goalLabelId = label NAME
  specificSubjects?: Array<{ category: string; order?: number; status?: boolean }>;
  materialCategories?: Array<{ category: string; order?: number }>;
  examCategories?: Array<{ category: string; order?: number }>;
}

const subjectRows = (refs?: Array<{ category: string; order?: number; status?: boolean }>) =>
  (refs ?? []).map((r) => ({ id: Number(r.category), order: r.order ?? 0, status: r.status ?? true })).filter((r) => Number.isInteger(r.id) && r.id > 0);
const catRows = (refs?: Array<{ category: string; order?: number }>) =>
  (refs ?? []).map((r) => ({ id: Number(r.category), order: r.order ?? 0 })).filter((r) => Number.isInteger(r.id) && r.id > 0);

export const createPackage = async (d: PackageWriteInput) => {
  const now = new Date();
  const gf = await resolveGoalFields(d.goalId, d.goalLabelId);
  const pkg = await repo.createPackage({
    data: {
      name: d.name ?? "",
      description: d.description ?? "",
      image: d.image ?? "",
      shareable_link: d.shareableLink ?? null,
      withMaterial: d.withMaterialText ?? "",
      withoutMaterial: d.withoutMaterialText ?? "",
      order_by: d.order ?? 0,
      active: d.active ?? true,
      // package_type_id / exam_id are NOT NULL → sentinels (1 = first type; goal 0).
      packageTypeId: d.packageTypeId ? parsePackageId(d.packageTypeId) ?? 1 : 1,
      examId: 0,
      educator_id: d.educatorId ? parsePackageId(d.educatorId) : null,
      goalId: gf.goalId,
      goalLabelId: gf.goalLabelId,
      created_at: now, updated_at: now,
    },
    specificSubjects: subjectRows(d.specificSubjects),
    materialCategories: catRows(d.materialCategories),
    examCategories: catRows(d.examCategories),
  });
  return toPackageDto(await repo.findById(pkg.id) as PkgRow, await loadEmbeds(pkg.id), gf.goalLabelName);
};

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
  if (d.packageTypeId !== undefined) data.packageTypeId = d.packageTypeId ? parsePackageId(d.packageTypeId) ?? 1 : 1;
  if (d.educatorId !== undefined) data.educator_id = d.educatorId ? parsePackageId(d.educatorId) : null;

  // Goal/label: validate the merged (goalId, labelName) pair when either is supplied,
  // then persist both numeric ids. Mirrors the Mongo branch's assertGoalLabelPair.
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
  }

  await repo.updatePackage(id, data, {
    specificSubjects: d.specificSubjects !== undefined ? subjectRows(d.specificSubjects) : undefined,
    materialCategories: d.materialCategories !== undefined ? catRows(d.materialCategories) : undefined,
    examCategories: d.examCategories !== undefined ? catRows(d.examCategories) : undefined,
  });
  const row = (await repo.findById(id)) as PkgRow;
  return toPackageDto(row, await loadEmbeds(id), await resolveLabelNameForRow(row));
};

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

// ── embedded reorder ─────────────────────────────────────────────────────────
export const reorderEmbedded = async (
  pkgId: number,
  field: "specificSubjects" | "materialCategories" | "examCategories",
  orders: Array<{ category: string; order: number }>
): Promise<"not_found" | "dup" | any> => {
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) return "dup";
  if (!(await repo.exists(pkgId))) return "not_found";
  await Promise.all(orders.map(({ category, order }) => {
    const catId = parsePackageId(category);
    if (!catId) return Promise.resolve();
    if (field === "specificSubjects") return repo.reorderSpecificSubject(pkgId, catId, order);
    if (field === "materialCategories") return repo.reorderMaterialCategory(pkgId, catId, order);
    return repo.reorderExamCategory(pkgId, catId, order);
  }));
  const embeds = await loadEmbeds(pkgId);
  return embeds[field];
};

// ── plans ──────────────────────────────────────────────────────────────────────
export const listPackagePlans = async (packageId: number): Promise<"not_found" | any[]> => {
  if (!(await repo.exists(packageId))) return "not_found";
  return (await repo.listPlans(packageId)).map(toPlanDto);
};

export const attachPlansToPackage = async (packageId: number, planIds: string[]): Promise<"not_found" | "no_valid" | { modified: number }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const ids = planIds.map((i) => parsePackageId(i)).filter((n): n is number => n != null);
  if (!ids.length) return "no_valid";
  const r = await repo.attachPlans(packageId, ids);
  return { modified: r.count };
};

export const detachPlan = async (packageId: number, planId: number): Promise<void> => {
  await repo.detachPlan(packageId, planId);
};

// ── subscribers ───────────────────────────────────────────────────────────────
export const listSubscribers = async (packageId: number, q: { page?: string; limit?: string }): Promise<"not_found" | { data: any[]; pagination: any }> => {
  if (!(await repo.exists(packageId))) return "not_found";
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "20", 10) || 20, 1), 100);
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
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      status: s.status ?? null,
      createdAt: s.createdAt ?? null,
    };
  });
  return { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

// ── video category relations ────────────────────────────────────────────────
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
