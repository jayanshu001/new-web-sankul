import { adminPlanRepository as repo, OWNED } from "./admin-plan.repository";
import { countPlanUsage, countPlanUsageOne } from "../../utils/planUsage";

export const ADMIN_PLAN_MODULE = "admin-plan";
export const isAdminPlanMysql = (): boolean => true;

export const parsePlanId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type OwnerKey = "courseId" | "packageId" | "ebookId";
const resolveOwner = (p: { courseId?: number | null; packageId?: number | null; ebookId?: number | null }): { key: OwnerKey; id: number } | null => {
  if (OWNED(p.courseId)) return { key: "courseId", id: p.courseId! };
  if (OWNED(p.packageId)) return { key: "packageId", id: p.packageId! };
  if (OWNED(p.ebookId)) return { key: "ebookId", id: p.ebookId! };
  return null;
};

const ref = (r: any) => (r ? { _id: String(r.id), name: r.name ?? null } : null);

const toDto = (p: any) => ({
  _id: String(p.id),
  name: p.name ?? null,
  duration: p.duration,
  price: p.price,
  withMaterial: p.withMaterial,
  materialPrice: p.materialPrice ?? 0,
  isDefault: p.isDefault,
  status: p.status,
  // "Most Popular" badge — computed, read-only (plan-popularity module ranks by
  // all-time paid orders). NOT writable here or anywhere else in the admin API;
  // the manual override was removed 2026-08-05 (docs/admin/MOST_POPULAR_PLAN_PIN.md).
  isMostPopular: p.isMostPopular ?? false,
  courseId: OWNED(p.courseId) ? (p.Course ? ref(p.Course) : String(p.courseId)) : null,
  packageId: OWNED(p.packageId) ? (p.Package ? ref(p.Package) : String(p.packageId)) : null,
  ebookId: OWNED(p.ebookId) ? (p.EBook ? ref(p.EBook) : String(p.ebookId)) : null,
  createdAt: p.created_at ?? null,
  updatedAt: p.updated_at ?? null,
});

// ── list / get ────────────────────────────────────────────────────────────────
export const listPlans = async (q: { entityType?: string; courseId?: string; packageId?: string; ebookId?: string; status?: string; isDefault?: string; withMaterial?: string; search?: string; sortBy?: string; sortDir?: "asc" | "desc"; page: number; limit: number }) => {
  const opts = {
    entityType: q.entityType,
    courseId: q.courseId ? toInt(q.courseId) ?? undefined : undefined,
    packageId: q.packageId ? toInt(q.packageId) ?? undefined : undefined,
    ebookId: q.ebookId ? toInt(q.ebookId) ?? undefined : undefined,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
    isDefault: q.isDefault === "true" ? true : q.isDefault === "false" ? false : undefined,
    withMaterial: q.withMaterial === "true" ? true : q.withMaterial === "false" ? false : undefined,
    search: q.search,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
  };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.count(opts),
  ]);
  // `orderCount` — all-time, status-blind — drives the panel's Delete lock. One
  // grouped query for the page (see utils/planUsage), never one per row.
  const usage = await countPlanUsage("price", rows.map((r) => r.id));
  return {
    items: rows.map((r) => ({ ...toDto(r), orderCount: usage.get(r.id) ?? 0 })),
    total,
  };
};

export const getPlanById = async (id: number) => {
  const plan = await repo.findById(id);
  if (!plan) return null;
  const [promotedCount, subscriberCount, orderCount] = await Promise.all([
    repo.promotedCount(id),
    // ⚠ subscriberCount keeps its existing ALL-TIME meaning — the delete guard has
    // always reported on it and the panel reads `orderCount ?? subscriberCount`.
    repo.subscriberCount(id),
    countPlanUsageOne("price", id),
  ]);
  return { ...toDto(plan), promotedCount, subscriberCount, orderCount };
};

// ── create / update ─────────────────────────────────────────────────────────
export interface PlanWriteInput {
  courseId?: string | null; packageId?: string | null; ebookId?: string | null;
  name?: string | null; duration?: number; price?: number;
  withMaterial?: boolean; materialPrice?: number; isDefault?: boolean; status?: boolean;
}

export const createPlan = async (input: PlanWriteInput) => {
  const courseId = toInt(input.courseId) ?? 0;
  const packageId = toInt(input.packageId) ?? 0;
  const ebookId = toInt(input.ebookId) ?? 0;
  const created = await repo.create({
    name: input.name ?? null,
    duration: input.duration!, price: input.price!,
    withMaterial: input.withMaterial ?? false, materialPrice: input.materialPrice ?? 0,
    isDefault: input.isDefault ?? false, status: input.status ?? true,
    courseId, packageId, ebookId,
    created_at: new Date(), updated_at: new Date(),
  });
  if (created.isDefault) {
    const owner = resolveOwner(created);
    if (owner) await repo.clearSiblingDefaults(owner.key, owner.id, created.id);
  }
  return toDto(await repo.findById(created.id));
};

/**
 * True when the incoming payload would change what a buyer actually paid for.
 * `materialPrice` is nullable in the DB but always 0 in the DTO, so both sides are
 * normalised — otherwise a null→0 no-op would read as a change and block the save.
 */
const changesPaidTerms = (existing: any, input: PlanWriteInput): boolean =>
  (input.duration !== undefined && input.duration !== existing.duration) ||
  (input.price !== undefined && input.price !== existing.price) ||
  (input.withMaterial !== undefined && input.withMaterial !== existing.withMaterial) ||
  (input.materialPrice !== undefined && (input.materialPrice ?? 0) !== (existing.materialPrice ?? 0));

/** The 422 body every frozen-terms rejection returns, so all five modules match. */
export const PLAN_TERMS_FROZEN_MESSAGE =
  "A saved plan's price, duration and material terms cannot be changed. Add a new plan and turn this one off instead.";

export const updatePlan = async (id: number, input: PlanWriteInput): Promise<any | null | "has_subscribers"> => {
  const existing = await repo.findBare(id);
  if (!existing) return null;
  // Commercial terms are frozen at creation (product rule, 2026-08-21). A wrong price
  // is corrected by adding a new plan and deactivating this one — never by rewriting
  // what buyers already paid.
  //
  // This used to fire only when `activeSubscriberCount(id) > 0`. That narrowing existed
  // for ONE reason: the old package/course edit form re-PUT every plan on save, so a
  // strict guard would have blocked unrelated edits. That form stopped writing saved
  // plans (frontend shipped 2026-08-21), and meanwhile the loose guard let a plan sold
  // twelve times in 2024 — all now expired — accept a repricing that rewrote what every
  // historical report says those customers paid.
  //
  // Still scoped to an ACTUAL change: `changesPaidTerms` compares against the stored
  // row, so a payload repeating the current values passes untouched. The live-course
  // and test-series product forms rely on that when they re-send `status` on a
  // paid→free switch — do NOT tighten this to "field present".
  //
  // name / status / isDefault stay editable. isDefault is editorial ("show this one
  // first"), not a term anyone paid for.
  if (changesPaidTerms(existing, input)) return "has_subscribers";

  // Re-linking a SOLD plan to a different product misattributes every historical order
  // as badly as repricing it, so it is frozen on the same terms. Unsold plans stay
  // freely movable.
  const relinking =
    (input.courseId !== undefined && (toInt(input.courseId) ?? 0) !== (existing.courseId ?? 0)) ||
    (input.packageId !== undefined && (toInt(input.packageId) ?? 0) !== (existing.packageId ?? 0)) ||
    (input.ebookId !== undefined && (toInt(input.ebookId) ?? 0) !== (existing.ebookId ?? 0));
  if (relinking && (await countPlanUsageOne("price", id)) > 0) return "has_subscribers";
  const data: any = { updated_at: new Date() };
  if (input.name !== undefined) data.name = input.name;
  if (input.duration !== undefined) data.duration = input.duration;
  if (input.price !== undefined) data.price = input.price;
  if (input.withMaterial !== undefined) data.withMaterial = input.withMaterial;
  if (input.materialPrice !== undefined) data.materialPrice = input.materialPrice;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.status !== undefined) data.status = input.status;
  // Re-linking: set chosen owner, 0 the others.
  const relink = input.courseId !== undefined || input.packageId !== undefined || input.ebookId !== undefined;
  if (relink) {
    data.courseId = toInt(input.courseId) ?? 0;
    data.packageId = toInt(input.packageId) ?? 0;
    data.ebookId = toInt(input.ebookId) ?? 0;
  }
  const updated = await repo.update(id, data);
  if (updated.isDefault) {
    const owner = resolveOwner(updated);
    if (owner) await repo.clearSiblingDefaults(owner.key, owner.id, updated.id);
  }
  return toDto(await repo.findById(id));
};

export const deletePlan = async (id: number): Promise<"ok" | "not_found" | { inUse: number }> => {
  const existing = await repo.findBare(id);
  if (!existing) return "not_found";
  // Widened from `subscriberCount` to the full all-time usage union so a plan with
  // only a PENDING order (no subscription row yet) is pinned too.
  const inUse = await countPlanUsageOne("price", id);
  if (inUse > 0) return { inUse };
  await repo.deletePromotedForPlan(id);
  await repo.delete(id);
  return "ok";
};

export const togglePlanStatus = async (id: number): Promise<boolean | null> => {
  const existing = await repo.findBare(id);
  if (!existing) return null;
  const updated = await repo.setStatus(id, !existing.status);
  return updated.status;
};

export const markAsDefault = async (id: number): Promise<"ok" | "not_found" | "no_owner" | any> => {
  const existing = await repo.findBare(id);
  if (!existing) return "not_found";
  const owner = resolveOwner(existing);
  if (!owner) return "no_owner";
  const updated = await repo.update(id, { isDefault: true, updated_at: new Date() });
  await repo.clearSiblingDefaults(owner.key, owner.id, id);
  return toDto(await repo.findById(id));
};

export const bulkStatus = async (ids: number[], status: boolean) => {
  const r = await repo.setStatusMany(ids, status);
  return r.count;
};

export const bulkDelete = async (ids: number[]): Promise<{ ok: false } | { ok: true; deleted: number }> => {
  // All-or-nothing, as today: one ordered plan in the selection refuses the batch.
  const usage = await countPlanUsage("price", ids);
  if ([...usage.values()].some((n) => n > 0)) return { ok: false };
  await repo.deletePromotedForPlans(ids);
  const r = await repo.deleteMany(ids);
  return { ok: true, deleted: r.count };
};

export const clonePlan = async (id: number, target: { courseId?: string; packageId?: string; ebookId?: string }): Promise<"not_found" | "bad_target" | any> => {
  const existing = await repo.findBare(id);
  if (!existing) return "not_found";
  const courseId = toInt(target.courseId) ?? 0;
  const packageId = toInt(target.packageId) ?? 0;
  const ebookId = toInt(target.ebookId) ?? 0;
  const owned = [courseId, packageId, ebookId].filter((v) => v > 0);
  if (owned.length !== 1) return "bad_target";
  const cloned = await repo.create({
    name: existing.name, duration: existing.duration, price: existing.price,
    withMaterial: existing.withMaterial, materialPrice: existing.materialPrice ?? 0,
    isDefault: false, status: existing.status,
    courseId, packageId, ebookId, created_at: new Date(), updated_at: new Date(),
  });
  return toDto(await repo.findById(cloned.id));
};
