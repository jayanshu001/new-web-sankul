// Package catalog: package detail and cached list pages with per-customer purchase state.
import type { Package } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { computeDaysLeft } from "../../utils/planDuration";
import { descendantsByRoot, selfFkDescendantsByRoot } from "../catalog-category-tree/category-tree.service";
import { listActivePricesByPackage, listActivePricesByPackages } from "../commerce-price/commerce-price.service";
import { getActivePackageSubscription, getActivePackageSubMap } from "../commerce-subscription/commerce-subscription.service";
import { appliesToGroups } from "../promo-code/promo-code.service";
import { examInCategoriesWhere } from "../catalog-exam/exam-category-pivot.where";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
import type { Prisma } from "@prisma/client";

// Subtree total from per-category tallies; exact only when an item has one category.
const sumOverSubtree = (subtree: number[] | undefined, root: number, perCat: Map<number, number>) =>
  (subtree ?? [root]).reduce((n, id) => n + (perCat.get(id) ?? 0), 0);

const countMap = (rows: any[], key: string) => {
  const m = new Map<number, number>();
  for (const r of rows) if (r[key] != null) m.set(r[key], r._count._all);
  return m;
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
  // Batched: 3 queries for the whole package instead of 3 per subject.
  const catIds = ordered.map((c) => c.id);
  const subtreeByCat = await descendantsByRoot(catIds);
  const union = [...new Set([...subtreeByCat.values()].flat())];
  const [videoRows, edgeRows] = await Promise.all([
    prisma.video.groupBy({ by: ["videoCategoryId"], where: { videoCategoryId: { in: union }, status: true }, _count: { _all: true } }),
    prisma.videoCategoryRelation.groupBy({ by: ["parent"], where: { parent: { in: catIds } }, _count: { _all: true } }),
  ]);
  const perCat = countMap(videoRows, "videoCategoryId");
  const edges = countMap(edgeRows, "parent");
  return ordered.map((cat) => ({
    category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory: (edges.get(cat.id) ?? 0) > 0, count: sumOverSubtree(subtreeByCat.get(cat.id), cat.id, perCat) },
  }));
};

const materialGroups = async (packageId: number) => {
  const refs = await prisma.materialCategoryPackage.findMany({ where: { packageId }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
  const ids = refs.map((r) => r.materialCategoryId).filter((n): n is number => n != null);
  if (!ids.length) return [];
  const cats = await prisma.materialCategory.findMany({ where: { id: { in: ids }, status: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ordered = refs.map((r) => byId.get(r.materialCategoryId!)).filter(Boolean) as typeof cats;
  const catIds = ordered.map((c) => c.id);
  const subtreeByCat = await selfFkDescendantsByRoot("ws_material_category", "parent", catIds);
  const union = [...new Set([...subtreeByCat.values()].flat())];
  const [materialRows, childRows] = await Promise.all([
    prisma.material.groupBy({ by: ["materialCategoryId"], where: { materialCategoryId: { in: union }, status: true }, _count: { _all: true } }),
    prisma.materialCategory.groupBy({ by: ["parent"], where: { parent: { in: catIds }, status: true }, _count: { _all: true } }),
  ]);
  const perCat = countMap(materialRows, "materialCategoryId");
  const children = countMap(childRows, "parent");
  return ordered.map((cat) => ({
    category: { _id: String(cat.id), title: cat.name, image: cat.image, havingChildDirectory: (children.get(cat.id) ?? 0) > 0, count: sumOverSubtree(subtreeByCat.get(cat.id), cat.id, perCat) },
  }));
};

const examGroups = async (packageId: number) => {
  const refs = await prisma.examCategoryPackage.findMany({ where: { packageId }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
  const ids = refs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  if (!ids.length) return [];
  const cats = await prisma.examCategory.findMany({ where: { id: { in: ids }, status: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const ordered = refs.map((r) => byId.get(r.examCategoryId!)).filter(Boolean) as typeof cats;
  // Subtrees and child counts batched; the exam count stays per category because an
  // exam can sit in several categories (pivot), so tallies cannot be summed.
  const catIds = ordered.map((c) => c.id);
  const [subtreeByCat, childRows] = await Promise.all([
    selfFkDescendantsByRoot("ws_exam_category", "parent_id", catIds),
    prisma.examCategory.groupBy({ by: ["parent"], where: { parent: { in: catIds }, status: true }, _count: { _all: true } }),
  ]);
  const children = countMap(childRows, "parent");
  return Promise.all(
    ordered.map(async (cat) => {
      const count = await prisma.exam.count({
        where: { AND: [examInCategoriesWhere(subtreeByCat.get(cat.id) ?? [cat.id]), { status: true }] },
      });
      return { category: { _id: String(cat.id), title: cat.name, name: cat.name, image: cat.image, havingChildDirectory: (children.get(cat.id) ?? 0) > 0, count } };
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
export const buildPackageDetailShared = async (packageId: number) => {
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
    ttlSeconds: CACHE_TTL.CATALOG_SHARED,
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
// Batched: 4 queries per page (plans, subscriber counts, types, goals) instead of 4 per row.
const enrichPackagesShared = async (rows: Package[]) => {
  const ids = rows.map((p) => p.id);
  const typeIds = [...new Set(rows.map((p) => p.packageTypeId).filter((n): n is number => n != null))];
  const goalIds = [...new Set(rows.map((p) => p.goalId).filter((n): n is number => n != null))];
  const [prices, subRows, types, goals] = await Promise.all([
    listActivePricesByPackages(ids),
    ids.length
      ? prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: ids }, status: true }, _count: { _all: true } })
      : Promise.resolve([] as any[]),
    typeIds.length ? prisma.packageType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    goalIds.length ? prisma.customerTargetGoal.findMany({ where: { id: { in: goalIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const subCounts = countMap(subRows, "packageId");
  const typeById = new Map(types.map((t) => [t.id, { _id: String(t.id), name: t.name }]));
  const goalById = new Map(goals.map((g) => [g.id, { _id: String(g.id), title: g.name }]));
  return rows.map((p) => {
    // Same split as splitPlans: active, duration-asc, by withMaterial.
    const own = prices.filter((x) => x.packageId === String(p.id));
    const plans = { withMaterial: own.filter((x) => x.withMaterial), withoutMaterial: own.filter((x) => !x.withMaterial) };
    const subCount = subCounts.get(p.id) ?? 0;
    const packageTypeId = p.packageTypeId != null ? typeById.get(p.packageTypeId) ?? null : null;
    const goalId = p.goalId != null ? goalById.get(p.goalId) ?? null : null;
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
  });
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
    ttlSeconds: CACHE_TTL.CATALOG_SHARED,
    load: async () => {
      const { rows, total } = await fetchRows();
      const shared = await enrichPackagesShared(rows);
      return { rows, total, shared };
    },
  });

  return { rows, total, data: await mergeLivePurchase(shared, rows, customerId, baseUrl) };
};

// Uncached variant of listPackagesCached's per-customer merge.
export const enrichPackagesSql = async (rows: Package[], customerId: number | null, baseUrl?: string) =>
  mergeLivePurchase(await enrichPackagesShared(rows), rows, customerId, baseUrl);

// One subscription query for the whole page (was one per row).
const mergeLivePurchase = async (shared: any[], rows: Package[], customerId: number | null, baseUrl?: string) => {
  const now = new Date();
  const subMap = await getActivePackageSubMap(customerId, rows.map((r) => r.id), now);
  return shared.map((item, i) => {
    const isPurchased = subMap.has(rows[i].id);
    return {
      ...item,
      isPurchased,
      daysLeft: isPurchased ? computeDaysLeft(subMap.get(rows[i].id) ?? null, now) : null,
      shareableLink: buildShareUrl("packages", item._id, baseUrl),
    };
  });
};

export const listPackagesPaginatedSql = async (opts: {
  search?: string; packageTypeId?: number; goalId?: number; isPaid?: boolean; isPopular?: boolean; skip: number; take: number;
}) => {
  const where: Prisma.PackageWhereInput = { active: true };
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

// Small reads the client package/payment controllers used to run inline.
export const findPackagesByIds = (ids: number[]) =>
  ids.length ? prisma.package.findMany({ where: { id: { in: ids } } }) : Promise.resolve([] as Package[]);

/** Active package's id + name, or null; a disabled package must not be purchasable. */
export const findActivePackageRef = (id: number) =>
  prisma.package.findFirst({ where: { id, active: true }, select: { id: true, name: true } });

export const listGoalsWithLabels = () =>
  prisma.customerTargetGoal.findMany({ select: { id: true, name: true, labels: true } });
