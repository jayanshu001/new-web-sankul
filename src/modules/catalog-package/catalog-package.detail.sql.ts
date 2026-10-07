// Package catalog: package detail and cached list pages with per-customer purchase state.
import type { Package } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { computeDaysLeft } from "../../utils/planDuration";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";
import { listActivePricesByPackage } from "../commerce-price/commerce-price.service";
import { getActivePackageSubscription } from "../commerce-subscription/commerce-subscription.service";
import { appliesToGroups } from "../promo-code/promo-code.service";
import { examInCategoriesWhere } from "../catalog-exam/exam-category-pivot.where";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";

const descendantIds = async (table: string, parentCol: string, rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${rootId} UNION SELECT c.id FROM ${table} c JOIN tree t ON c.${parentCol} = t.id) SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

const videoGroups = async (packageId: number) => {
  const subs = await prisma.packageSpecificSubject.findMany({
    where: { packageId, status: true },
    select: { subjectId: true, order_by: true },
    orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
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
  const refs = await prisma.materialCategoryPackage.findMany({ where: { packageId }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
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
  const refs = await prisma.examCategoryPackage.findMany({ where: { packageId }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
  const ids = refs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  if (!ids.length) return [];
  const cats = await prisma.examCategory.findMany({ where: { id: { in: ids }, status: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ordered = refs.map((r) => byId.get(r.examCategoryId!)).filter(Boolean) as typeof cats;
  return Promise.all(
    ordered.map(async (cat) => {
      const sub = await descendantIds("ws_exam_category", "parent_id", cat.id);
      const [count, childCount] = await Promise.all([
        prisma.exam.count({
          where: { AND: [examInCategoriesWhere(sub), { status: true }] },
        }),
        prisma.examCategory.count({ where: { parent: cat.id, status: true } }),
      ]);
      return { category: { _id: String(cat.id), title: cat.name, name: cat.name, image: cat.image, havingChildDirectory: childCount > 0, count } };
    })
  );
};

const splitPlans = async (packageId: number) => {
  const plans = await listActivePricesByPackage(packageId); // active, duration-asc
  return {
    withMaterial: plans.filter((p) => p.withMaterial),
    withoutMaterial: plans.filter((p) => !p.withMaterial),
  };
};

const availablePromo = async (packageId: number) => {
  const now = new Date();
  const rows = await prisma.promocode.findMany({
    // "mixed" rows are included; appliesToGroups resolves whether they cover this package.
    where: { type: "public", status: true, promo_start_at: { lte: now }, promo_expire_at: { gte: now }, appliesToType: { in: ["package", "mixed"] } },
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

// Everything here is customer-independent and cached. isPurchased/daysLeft is the
// only per-customer field and is always computed live in buildPackageDetailSql;
// package.routes.ts must not wrap this in a user-scoped cacheRoute either.
const buildPackageDetailShared = async (packageId: number) => {
  // No `active` filter: the entry is shared and an inactive package must stay
  // reachable for its subscribers. The per-caller gate is in buildPackageDetailSql.
  const pkg = await prisma.package.findFirst({ where: { id: packageId } });
  if (!pkg) return null;

  const [videos, materials, tests, plans, availablePromoCode, packageType, goal] = await Promise.all([
    videoGroups(packageId),
    materialGroups(packageId),
    examGroups(packageId),
    splitPlans(packageId),
    availablePromo(packageId),
    populatePackageType(pkg.packageTypeId),
    populateGoal(pkg.goalId),
  ]);

  return {
    scope: { kind: "package", id: String(pkg.id) },
    pkg,
    packageType,
    goal,
    videos,
    materials,
    tests,
    plans,
    availablePromoCode,
  };
};

// Cached shared detail plus live purchase state; an inactive package shows only to subscribers.
export const buildPackageDetailSql = async (packageId: number, customerId: number | null, baseUrl?: string) => {
  const shared = await cache.aside({
    key: cache.key(CacheDomain.Client, CacheEntity.CatalogPackage, `detail:${packageId}`),
    ttlSeconds: 60,
    load: () => buildPackageDetailShared(packageId),
  });
  if (!shared) return null;
  const { pkg, packageType, goal, videos, materials, tests, plans, availablePromoCode } = shared;

  const activeSub = customerId ? await getActivePackageSubscription(customerId, packageId) : null;
  // An inactive package stays visible only to customers with an active subscription.
  if (!pkg.active && !activeSub) return null;
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
      isPopular: pkg.isPopular ?? false,
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

// No customerId here; `shareableLink` depends on the request's baseUrl, so callers add it after the cache read.
const enrichPackagesShared = async (rows: Package[]) => {
  return Promise.all(
    rows.map(async (p) => {
      const [plans, subCount, packageTypeId, goalId] = await Promise.all([
        splitPlans(p.id),
        prisma.packageCourseSubscription.count({ where: { packageId: p.id, status: true } }),
        populatePackageType(p.packageTypeId),
        populateGoal(p.goalId),
      ]);
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
        isPopular: p.isPopular ?? false,
        order: p.order_by,
        active: p.active,
        pcMaterialId: p.pcMaterialId != null ? String(p.pcMaterialId) : null,
        examId: p.examId != null ? String(p.examId) : null,
        createdAt: p.created_at ?? null,
        updatedAt: p.updated_at ?? null,
        plans,
        subscriberCount: subCount,
      };
    })
  );
};

/**
 * Caches the filtered page plus its shared enrichment as one unit under
 * CacheEntity.CatalogPackage (keyed by `cacheKeyId`), then merges the live
 * per-customer isPurchased/daysLeft and the request's shareableLink.
 */
export const listPackagesCached = async (
  cacheKeyId: string,
  fetchRows: () => Promise<{ rows: Package[]; total: number }>,
  customerId: number | null,
  baseUrl?: string
): Promise<{ rows: Package[]; total: number; data: any[] }> => {
  const { rows, total, shared } = await cache.aside({
    key: cache.key(CacheDomain.Client, CacheEntity.CatalogPackage, cacheKeyId),
    ttlSeconds: 60,
    load: async () => {
      const { rows, total } = await fetchRows();
      const shared = await enrichPackagesShared(rows);
      return { rows, total, shared };
    },
  });

  const now = new Date();
  const data = await Promise.all(
    shared.map(async (item, i) => {
      const activeSub = customerId ? await getActivePackageSubscription(customerId, rows[i].id, now) : null;
      const isPurchased = !!activeSub;
      return {
        ...item,
        isPurchased,
        daysLeft: isPurchased ? computeDaysLeft(activeSub?.endAt ?? null, now) : null,
        shareableLink: buildShareUrl("packages", item._id, baseUrl),
      };
    })
  );
  return { rows, total, data };
};

// Uncached variant of listPackagesCached's per-customer merge.
export const enrichPackagesSql = async (rows: Package[], customerId: number | null, baseUrl?: string) => {
  const now = new Date();
  const shared = await enrichPackagesShared(rows);
  return Promise.all(
    shared.map(async (item, i) => {
      const activeSub = customerId ? await getActivePackageSubscription(customerId, rows[i].id, now) : null;
      const isPurchased = !!activeSub;
      return {
        ...item,
        isPurchased,
        daysLeft: isPurchased ? computeDaysLeft(activeSub?.endAt ?? null, now) : null,
        shareableLink: buildShareUrl("packages", item._id, baseUrl),
      };
    })
  );
};

export const listPackagesPaginatedSql = async (opts: {
  search?: string; packageTypeId?: number; goalId?: number; isPaid?: boolean; isPopular?: boolean; skip: number; take: number;
}) => {
  const where: any = { active: true };
  const search = buildPrismaSearch(opts.search, ["name"]);
  if (search) where.AND = search.AND;
  if (opts.isPaid !== undefined) where.isPaid = opts.isPaid;
  if (opts.isPopular !== undefined) where.isPopular = opts.isPopular;
  if (opts.packageTypeId != null) where.packageTypeId = opts.packageTypeId;
  if (opts.goalId != null) where.goalId = opts.goalId;
  const [rows, total] = await Promise.all([
    prisma.package.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.package.count({ where }),
  ]);
  return { rows, total };
};

type ListOpts = { search?: string; skip?: number; take?: number };
const withSearch = (where: any, opts?: ListOpts) =>
  ({ ...where, ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}) });

export const listPackagesByTypeSql = async (packageTypeId: number, opts: ListOpts = {}) => {
  const where = withSearch({ active: true, packageTypeId }, opts);
  const [rows, total] = await Promise.all([
    prisma.package.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.package.count({ where }),
  ]);
  return { rows, total };
};

export const listPackagesByGoalLabelSql = async (goalLabelId: number, opts: ListOpts = {}) => {
  const where = withSearch({ active: true, goalLabelId }, opts);
  const [rows, total] = await Promise.all([
    prisma.package.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.package.count({ where }),
  ]);
  return { rows, total };
};

// Label ids restart at 1 per goal, so filtering on goalLabelId alone leaks
// packages across goals; scope by both goalId and goalLabelId.
export const listPackagesByGoalLabelScopedSql = async (goalId: number, goalLabelId: number, opts: ListOpts = {}) => {
  const where = withSearch({ active: true, goalId, goalLabelId }, opts);
  const [rows, total] = await Promise.all([
    prisma.package.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.package.count({ where }),
  ]);
  return { rows, total };
};

export const listPackagesByGoalIndividualSql = async (goalId: number, opts: ListOpts = {}) => {
  const where = withSearch({ active: true, goalId, isIndividual: true }, opts);
  const [rows, total] = await Promise.all([
    prisma.package.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.package.count({ where }),
  ]);
  return { rows, total };
};
