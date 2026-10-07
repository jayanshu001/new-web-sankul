// Package categories: admin CRUD and client category lists with recorded/live cards.
import { prisma } from "../../config/prisma";
import * as liveSql from "../admin-live-course/admin-live-course.service";
import { buildPrismaSearch, buildPrismaPrefixSearch } from "../../utils/searchFilter";
import { nextOrder } from "../../utils/listOrdering";
import { getActivePackageSubMap } from "../commerce-subscription/commerce-subscription.service";
import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";

export const parsePkgCatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const toPkgCatDto = (r: any) => ({
  _id: String(r.id),
  title: r.title,
  slug: r.slug,
  image: r.image ?? null,
  order: r.order,
  status: r.status,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

const idStr = (v: number | null | undefined): string | null => (v != null ? String(v) : null);

// ws_package row + its plans → a `recorded[]` card (plans default-first then by duration).
//  - `subEndAt`: the customer's active subscription end for this package, or
//    `undefined` when there is none → drives isPurchased/daysLeft.
//  - `baseUrl`: request origin, so shareableLink is built like every other surface;
//    ws_package.shareable_link is junk (mostly NULL/""/"https://").
const toCategoryPackageDto = (
  p: any,
  allPlans: any[],
  opts: { subEndAt?: Date | null; baseUrl?: string } = {}
) => {
  const plans = allPlans
    .filter((pl) => pl.packageId === p.id)
    .map((pl) => ({
      _id: String(pl.id),
      packageId: idStr(pl.packageId),
      name: pl.name ?? null,
      duration: pl.duration,
      price: pl.price,
      withMaterial: pl.withMaterial,
      materialPrice: pl.materialPrice ?? 0,
      isDefault: pl.isDefault,
    }))
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return (a.duration ?? 0) - (b.duration ?? 0);
    });
  const defaultPlan = plans.find((pl) => pl.isDefault) ?? plans[0] ?? null;
  // `undefined` = no active subscription; `null` = active lifetime (purchased, daysLeft null).
  const isPurchased = opts.subEndAt !== undefined;
  return {
    _id: String(p.id),
    name: p.name,
    description: p.description,
    image: p.image ?? null,
    shareableLink: buildShareUrl("packages", String(p.id), opts.baseUrl),
    order: p.order_by,
    isPurchased,
    daysLeft: isPurchased ? computeDaysLeft(opts.subEndAt ?? null) : null,
    isPaid: p.isPaid,
    withMaterialText: p.withMaterial,
    withoutMaterialText: p.withoutMaterial,
    packageTypeId: idStr(p.packageTypeId),
    goalId: idStr(p.goalId),
    educatorId: idStr(p.educator_id),
    plans,
    defaultPlan,
    startingPrice: defaultPlan ? defaultPlan.price : null,
  };
};

export type PackageCategoryTab = "recorded" | "live";

export interface ListPackagesAndLiveOpts {
  tab?: PackageCategoryTab;
  search?: string | null;
  skip?: number;
  take?: number;
  baseUrl?: string;
}

/**
 * GET /client/package-categories/:id → { recorded, live }. No 404 for an unknown
 * category: it returns empty arrays.
 *
 * Each FE tab searches and paginates independently, so only the active tab's list
 * is populated (the other is `[]`, kept for contract). `counts` carries both tabs'
 * totals under the current search so the badges stay accurate.
 *
 * Live cards reuse the `admin-live-course.listClient` helpers so they are byte-identical
 * to GET /client/live-courses; `customerId` resolves daysLeft/isPurchased
 * (null/false without it).
 */
export const listPackagesAndLiveByCategory = async (
  categoryId: number,
  customerId: number | null = null,
  opts: ListPackagesAndLiveOpts = {}
) => {
  const tab: PackageCategoryTab = opts.tab === "live" ? "live" : "recorded";
  const search = opts.search?.trim() || null;
  const skip = opts.skip ?? 0;
  const take = opts.take ?? 20;

  const pkgWhere: any = { active: true, packageCategoryId: categoryId };
  const liveWhere: any = { status: true, packageCategoryId: categoryId };
  const nameSearch = buildPrismaSearch(search, ["name"]);
  if (nameSearch) {
    pkgWhere.AND = nameSearch.AND;
    liveWhere.AND = nameSearch.AND;
  }

  const [recordedTotal, liveTotal] = await Promise.all([
    prisma.package.count({ where: pkgWhere }),
    prisma.liveCourse.count({ where: liveWhere }),
  ]);
  const counts = { recorded: recordedTotal, live: liveTotal };

  if (tab === "recorded") {
    const packages = await prisma.package.findMany({ where: pkgWhere, orderBy: [{ order_by: "asc" }, { created_at: "asc" }, { id: "desc" }], skip, take });
    const pkgIds = packages.map((p) => p.id);
    // Plans and entitlements are fetched for the whole page in one query each, not per row.
    const [plans, subMap] = await Promise.all([
      pkgIds.length
        ? prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: pkgIds }, status: true } })
        : Promise.resolve([] as any[]),
      getActivePackageSubMap(customerId, pkgIds),
    ]);
    return {
      tab,
      recorded: packages.map((p) =>
        toCategoryPackageDto(p, plans, {
          // `has` distinguishes "no subscription" from an active lifetime one (value null).
          subEndAt: subMap.has(p.id) ? subMap.get(p.id) ?? null : undefined,
          baseUrl: opts.baseUrl,
        })
      ),
      live: [] as any[],
      counts,
      total: recordedTotal,
    };
  }

  const liveCourses = await prisma.liveCourse.findMany({ where: liveWhere, orderBy: [{ ordered: "asc" }, { createdAt: "asc" }, { id: "desc" }], skip, take });
  const liveIds = liveCourses.map((c) => c.id);
  const [liveDaysLeft, liveOwned, livePlans] = await Promise.all([
    liveSql.getDaysLeftMap(customerId, liveIds),
    liveSql.getOwnedCourseIds(customerId),
    liveIds.length ? liveSql.plansGrouped(liveIds) : Promise.resolve(new Map<number, any[]>()),
  ]);
  return {
    tab,
    recorded: [] as any[],
    live: liveCourses.map((c) => {
      const key = String(c.id);
      return {
        ...liveSql.toCourseDto(c),
        daysLeft: liveDaysLeft.has(key) ? liveDaysLeft.get(key) ?? null : null,
        isPurchased: liveOwned.has(key),
        plans: liveSql.splitPlansByMaterial(livePlans.get(c.id) ?? []),
      };
    }),
    counts,
    total: liveTotal,
  };
};

// skip/take omitted → full list.
export const listAll = async (q?: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) => {
  const where: any = {};
  const titleSearch = buildPrismaPrefixSearch(q?.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;
  // Recency is the contract on admin lists (utils/listOrdering): the "order" sort and
  // the default both mean newest-first, ignoring sortDir. `order` still drives the client list.
  const col = q?.sortBy === "title" ? "title" : q?.sortBy === "createdAt" ? "createdAt" : null;
  const orderBy: any[] = col ? [{ [col]: q?.sortDir ?? "asc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }];
  const [rows, total] = await Promise.all([
    prisma.packageCategory.findMany({
      where,
      orderBy,
      ...(q?.skip !== undefined ? { skip: q.skip } : {}),
      ...(q?.take !== undefined ? { take: q.take } : {}),
    }),
    prisma.packageCategory.count({ where }),
  ]);
  return { data: rows.map(toPkgCatDto), total };
};

export const create = async (input: { title: string; slug: string; image?: string; order?: number; status?: boolean }) => {
  const order = input.order ?? nextOrder((await prisma.packageCategory.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { order: true } }))?.order);
  const row = await prisma.packageCategory.create({
    data: { title: input.title, slug: input.slug, image: input.image ?? null, order, status: input.status ?? true },
  });
  return toPkgCatDto(row);
};

export const update = async (id: number, input: { title?: string; slug?: string; image?: string; order?: number; status?: boolean }) => {
  const exists = await prisma.packageCategory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const data: any = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.image !== undefined) data.image = input.image;
  if (input.order !== undefined) data.order = input.order;
  if (input.status !== undefined) data.status = input.status;
  const row = await prisma.packageCategory.update({ where: { id }, data });
  return toPkgCatDto(row);
};

export const remove = async (id: number): Promise<boolean> => {
  const exists = await prisma.packageCategory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.packageCategory.delete({ where: { id } });
  return true;
};

const packageCountFor = async (catIds: number[]): Promise<Map<number, number>> => {
  if (!catIds.length) return new Map();
  const rows = await prisma.package.groupBy({
    by: ["packageCategoryId"],
    where: { active: true, packageCategoryId: { in: catIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r: any) => [r.packageCategoryId as number, r._count._all as number]));
};

const liveCourseCountFor = async (catIds: number[]): Promise<Map<number, number>> => {
  if (!catIds.length) return new Map();
  const rows = await prisma.liveCourse.groupBy({
    by: ["packageCategoryId"],
    where: { status: true, packageCategoryId: { in: catIds } },
    _count: { _all: true },
  });
  return new Map(
    rows
      .filter((r: any) => r.packageCategoryId != null)
      .map((r: any) => [r.packageCategoryId as number, r._count._all as number])
  );
};

/**
 * `packageCount` mirrors the category detail's two arrays:
 *   - live=false → recorded packages + live courses
 *   - live=true  → live courses only (and only categories with ≥1 live course)
 */
export const listClientPackageCategories = async (opts: {
  liveOnly: boolean; search: string | null; skip: number; limitNum: number; pageNum: number;
}) => {
  const where: any = { status: true };
  const titleSearch = buildPrismaSearch(opts.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;

  if (!opts.liveOnly) {
    const [rawList, total] = await Promise.all([
      prisma.packageCategory.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "desc" }], skip: opts.skip, take: opts.limitNum }),
      prisma.packageCategory.count({ where }),
    ]);
    const ids = rawList.map((c) => c.id);
    const [pkgMap, liveMap] = await Promise.all([packageCountFor(ids), liveCourseCountFor(ids)]);
    const data = rawList.map((c) => ({
      ...toPkgCatDto(c),
      packageCount: (pkgMap.get(c.id) ?? 0) + (liveMap.get(c.id) ?? 0),
    }));
    return { data, pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
  }

  const categories = await prisma.packageCategory.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const liveMap = await liveCourseCountFor(categories.map((c) => c.id));
  const filtered = categories.filter((c) => (liveMap.get(c.id) ?? 0) > 0);
  const total = filtered.length;
  const paged = filtered.slice(opts.skip, opts.skip + opts.limitNum);
  const data = paged.map((c) => ({ ...toPkgCatDto(c), packageCount: liveMap.get(c.id) ?? 0 }));
  return { data, pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
};
