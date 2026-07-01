/**
 * catalog-package — SQL composition for the package detail + list endpoints.
 *
 * Reproduces the Mongo `buildPackageDetail` / `enrichPackages` DTO from SQL:
 *   - video groups   ← ws_package_specific_subject  → ws_video_category (DAG count)
 *   - material groups ← ws_material_category_package → ws_material_category (CTE count)
 *   - exam groups     ← ws_exam_category_package     → ws_exam_category (CTE count)
 *   - plans           ← commerce-price (split by withMaterial)
 *   - promo           ← ws_promo_code (public + active window + appliesTo=package)
 *   - subscription    ← commerce-subscription (active → isPurchased + daysLeft)
 *   - packageType/goal populates ← ws_package_type / ws_goal
 *
 * Functional parity with the Mongo contract: the consumer-facing fields are
 * identical. Incidental Mongo-only doc fields not stored in SQL (e.g. __v,
 * isMagazine, notificationTopic, the per-category slug/parent spread) are not
 * reproduced — documented drift, mirrors the other catalog sub-modules.
 */
import type { Package } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { computeDaysLeft } from "../../utils/planDuration";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";
import { listActivePricesByPackage } from "../commerce-price/commerce-price.service";
import { getActivePackageSubscription } from "../commerce-subscription/commerce-subscription.service";
import { appliesToGroups } from "../promo-code/promo-code.service";

const descendantIds = async (table: string, parentCol: string, rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${rootId} UNION SELECT c.id FROM ${table} c JOIN tree t ON c.${parentCol} = t.id) SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

// ── category groups ──────────────────────────────────────────────────────────
const videoGroups = async (packageId: number) => {
  const subs = await prisma.packageSpecificSubject.findMany({
    where: { packageId, status: true },
    select: { subjectId: true, order_by: true },
    orderBy: { order_by: "asc" },
  });
  const ids = subs.map((s) => s.subjectId).filter((n): n is number => n != null);
  if (!ids.length) return [];
  const cats = await prisma.videoCategory.findMany({ where: { id: { in: ids }, status: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof cats;
  return Promise.all(
    ordered.map(async (cat) => {
      const subtree = await descendantsOf([cat.id]);
      const [count, childCount] = await Promise.all([
        prisma.video.count({ where: { videoCategoryId: { in: subtree }, status: true } }),
        prisma.videoCategoryRelation.count({ where: { parent: cat.id } }),
      ]);
      return { category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory: childCount > 0, count } };
    })
  );
};

const materialGroups = async (packageId: number) => {
  const refs = await prisma.materialCategoryPackage.findMany({ where: { packageId }, orderBy: { order: "asc" } });
  const ids = refs.map((r) => r.materialCategoryId).filter((n): n is number => n != null);
  if (!ids.length) return [];
  const cats = await prisma.materialCategory.findMany({ where: { id: { in: ids }, status: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ordered = refs.map((r) => byId.get(r.materialCategoryId!)).filter(Boolean) as typeof cats;
  return Promise.all(
    ordered.map(async (cat) => {
      const sub = await descendantIds("ws_material_category", "parent", cat.id);
      const [count, childCount] = await Promise.all([
        prisma.material.count({ where: { materialCategoryId: { in: sub }, status: true } }),
        prisma.materialCategory.count({ where: { parent: cat.id, status: true } }),
      ]);
      return { category: { _id: String(cat.id), title: cat.name, image: cat.image, havingChildDirectory: childCount > 0, count } };
    })
  );
};

const examGroups = async (packageId: number) => {
  const refs = await prisma.examCategoryPackage.findMany({ where: { packageId }, orderBy: { order: "asc" } });
  const ids = refs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  if (!ids.length) return [];
  const cats = await prisma.examCategory.findMany({ where: { id: { in: ids }, status: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ordered = refs.map((r) => byId.get(r.examCategoryId!)).filter(Boolean) as typeof cats;
  return Promise.all(
    ordered.map(async (cat) => {
      const sub = await descendantIds("ws_exam_category", "parent_id", cat.id);
      const [count, childCount] = await Promise.all([
        prisma.exam.count({ where: { examCategoryId: { in: sub }, status: true } }),
        prisma.examCategory.count({ where: { parent: cat.id, status: true } }),
      ]);
      return { category: { _id: String(cat.id), title: cat.name, name: cat.name, image: cat.image, havingChildDirectory: childCount > 0, count } };
    })
  );
};

// ── plans / promo / populates ────────────────────────────────────────────────
const splitPlans = async (packageId: number) => {
  const plans = await listActivePricesByPackage(packageId); // active, duration-asc
  return {
    withMaterial: plans.filter((p) => p.withMaterial),
    withoutMaterial: plans.filter((p) => !p.withMaterial),
  };
};

const availablePromo = async (packageId: number) => {
  const now = new Date();
  const rows = await prisma.promoCodeRule.findMany({
    // Single-type "package" rows + multi-type "mixed" rows; coverage resolved
    // via appliesToGroups so mixed codes covering this package are included.
    where: { type: "public", status: true, promoStartAt: { lte: now }, promoExpireAt: { gte: now }, appliesToType: { in: ["package", "mixed"] } },
    select: { promocode: true, title: true, description: true, appliesToType: true, appliesToIds: true },
  });
  return rows
    .filter((r) => appliesToGroups(r).some((g) => g.type === "package" && g.ids.includes(packageId)))
    .map((c) => ({ title: c.title ?? "", promocode: c.promocode, description: c.description ?? "" }));
};

const populatePackageType = async (id: number | null) => {
  if (id == null) return null;
  const t = await prisma.packageType.findUnique({ where: { id }, select: { id: true, name: true } });
  return t ? { _id: String(t.id), name: t.name } : null;
};
const populateGoal = async (id: number | null) => {
  if (id == null) return null;
  const g = await prisma.customerTargetGoal.findUnique({ where: { id }, select: { id: true, name: true } });
  return g ? { _id: String(g.id), title: g.name } : null;
};

// ── detail ───────────────────────────────────────────────────────────────────
export const buildPackageDetailSql = async (packageId: number, customerId: number | null, baseUrl?: string) => {
  const pkg = await prisma.package.findFirst({ where: { id: packageId, active: true } });
  if (!pkg) return null;

  const [videos, materials, tests, plans, availablePromoCode, packageType, goal, activeSub] = await Promise.all([
    videoGroups(packageId),
    materialGroups(packageId),
    examGroups(packageId),
    splitPlans(packageId),
    availablePromo(packageId),
    populatePackageType(pkg.packageTypeId),
    populateGoal(pkg.goalId),
    customerId ? getActivePackageSubscription(customerId, packageId) : Promise.resolve(null),
  ]);

  const isPurchased = !!activeSub;
  const daysLeft = isPurchased ? computeDaysLeft(activeSub?.endAt ?? null) : null;

  return {
    scope: { kind: "package", id: String(pkg.id) },
    package: {
      _id: String(pkg.id),
      name: pkg.name,
      subtitle: "",
      description: pkg.description,
      image: pkg.image,
      shareableLink: buildShareUrl("packages", String(pkg.id), baseUrl),
      withMaterialText: pkg.withMaterial,
      withoutMaterialText: pkg.withoutMaterial,
      packageType,
      goal,
      isPaid: pkg.isPaid,
      isPurchased,
      daysLeft,
      examCountdownCategoryIds: [],
      examCountdownIds: [],
    },
    videos,
    materials,
    tests,
    plans,
    availablePromoCode,
  };
};

// ── list enrichment ──────────────────────────────────────────────────────────
export const enrichPackagesSql = async (rows: Package[], customerId: number | null, baseUrl?: string) => {
  const now = new Date();
  return Promise.all(
    rows.map(async (p) => {
      const [plans, subCount, packageTypeId, goalId, activeSub] = await Promise.all([
        splitPlans(p.id),
        prisma.packageCourseSubscription.count({ where: { packageId: p.id, status: true } }),
        populatePackageType(p.packageTypeId),
        populateGoal(p.goalId),
        customerId ? getActivePackageSubscription(customerId, p.id, now) : Promise.resolve(null),
      ]);
      const isPurchased = !!activeSub;
      return {
        _id: String(p.id),
        name: p.name,
        subtitle: "",
        description: p.description,
        image: p.image,
        withMaterialText: p.withMaterial,
        withoutMaterialText: p.withoutMaterial,
        packageTypeId,
        goalId,
        goalLabelId: p.goalLabelId != null ? String(p.goalLabelId) : null,
        isPaid: p.isPaid,
        isSmartCourse: p.isSmartCourse,
        isPlannerCourse: p.isPlannerCourse,
        order: p.order_by,
        active: p.active,
        pcMaterialId: p.pcMaterialId != null ? String(p.pcMaterialId) : null,
        examId: p.examId != null ? String(p.examId) : null,
        createdAt: p.created_at ?? null,
        updatedAt: p.updated_at ?? null,
        plans,
        subscriberCount: subCount,
        isPurchased,
        daysLeft: isPurchased ? computeDaysLeft(activeSub?.endAt ?? null, now) : null,
        shareableLink: buildShareUrl("packages", String(p.id), baseUrl),
      };
    })
  );
};

// ── list queries (filters mirror the Mongo controller) ───────────────────────
export const listPackagesPaginatedSql = async (opts: {
  search?: string; packageTypeId?: number; goalId?: number; isSmartCourse?: boolean; isPlannerCourse?: boolean; isPaid?: boolean; skip: number; take: number;
}) => {
  const where: any = { active: true };
  if (opts.search) where.name = { contains: opts.search };
  if (opts.isPaid !== undefined) where.isPaid = opts.isPaid;
  if (opts.packageTypeId != null) where.packageTypeId = opts.packageTypeId;
  if (opts.goalId != null) where.goalId = opts.goalId;
  if (opts.isSmartCourse !== undefined) where.isSmartCourse = opts.isSmartCourse;
  if (opts.isPlannerCourse !== undefined) where.isPlannerCourse = opts.isPlannerCourse;
  const [rows, total] = await Promise.all([
    prisma.package.findMany({ where, orderBy: [{ order_by: "asc" }, { id: "desc" }], skip: opts.skip, take: opts.take }),
    prisma.package.count({ where }),
  ]);
  return { rows, total };
};

export const listPackagesByTypeSql = async (packageTypeId: number) =>
  prisma.package.findMany({ where: { active: true, packageTypeId }, orderBy: [{ order_by: "asc" }, { id: "desc" }] });

export const listPackagesByGoalLabelSql = async (goalLabelId: number) =>
  prisma.package.findMany({ where: { active: true, goalLabelId }, orderBy: [{ order_by: "asc" }, { id: "desc" }] });

// Goal-scoped label lookup. Label ids are per-goal (they restart at 1 per goal),
// so filtering on goalLabelId alone leaks packages across goals that share the id.
// Scope by BOTH goalId + goalLabelId to get the packages for exactly one label.
export const listPackagesByGoalLabelScopedSql = async (goalId: number, goalLabelId: number) =>
  prisma.package.findMany({ where: { active: true, goalId, goalLabelId }, orderBy: [{ order_by: "asc" }, { id: "desc" }] });

// Goal-level ("individual") packages for a label-less goal: goalId set, is_individual=true.
export const listPackagesByGoalIndividualSql = async (goalId: number) =>
  prisma.package.findMany({ where: { active: true, goalId, isIndividual: true }, orderBy: [{ order_by: "asc" }, { id: "desc" }] });
