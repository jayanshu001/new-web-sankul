/**
 * PackageCategory — dual-path SQL/Mongo. Net-new SQL table ws_package_category
 * (2026-06-19), backfilled from Mongo ws_package_categories.
 *
 * Scope: admin CRUD (list/create/update/delete) + the client category LISTING
 * (`listPackageCategories`, with per-category active-package count + the
 * ?live=true filter) + the client `listPackagesByCategory` detail join
 * (`listPackagesAndLiveByCategory`). The detail join is now SQL-backed:
 * ws_package carries is_paid and
 * ws_live_course carries package_category_id, so packages + live courses for a
 * category resolve entirely on MySQL.
 */
import { prisma } from "../../config/prisma";
import * as liveSql from "../admin-live-course/admin-live-course.service";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const PACKAGE_CATEGORY_MODULE = "package-category";
export const isPackageCategoryMysql = (): boolean => true;

export const parsePkgCatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** SQL row → Mongo-shaped DTO (`_id`, `order`, timestamps passthrough). */
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

// ws_package row + its plans → the Mongo `recorded[]` shape (plans sorted
// default-first then by duration; defaultPlan + startingPrice derived).
const toCategoryPackageDto = (p: any, allPlans: any[]) => {
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
  return {
    _id: String(p.id),
    name: p.name,
    description: p.description,
    image: p.image ?? null,
    shareableLink: p.shareable_link ?? null,
    order: p.order_by,
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

/**
 * GET /client/package-categories/:id → { recorded, live }. Active packages (with
 * plans/defaultPlan/startingPrice) and active live courses in this package
 * category. No category existence check / 404 — mirrors the Mongo handler, which
 * returns empty arrays for an unknown id.
 *
 * Live courses use the SAME card contract as GET /client/live-courses
 * (`admin-live-course.listClient`): full course DTO + plans split by material +
 * per-customer `daysLeft`/`isPurchased`. Passing `customerId` (from the bearer
 * token) is what lets daysLeft/isPurchased resolve; without it they default to
 * null/false. Reusing the canonical helpers keeps the two live-course listings
 * byte-identical so a card here and on the Live Batches tab agree.
 */
export type PackageCategoryTab = "recorded" | "live";

export interface ListPackagesAndLiveOpts {
  tab?: PackageCategoryTab;
  search?: string | null;
  skip?: number;
  take?: number;
}

/**
 * The listing has two FE tabs — `recorded` (packages) and `live` (live courses).
 * Each tab searches (title/name, case-insensitive) and paginates independently at
 * the DB level, so the FE calls this per active tab (`?tab=live&page=2&search=x`).
 * `counts` carries the total matching rows for BOTH tabs under the current search
 * so the tab badges stay accurate regardless of which tab is being paged. Only the
 * active tab's list is populated; the other returns `[]` (keys kept for contract).
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

  // Both-tab counts for the FE tab badges — computed under the current search so
  // the badge on the inactive tab still reflects what a switch would return.
  const [recordedTotal, liveTotal] = await Promise.all([
    prisma.package.count({ where: pkgWhere }),
    prisma.liveCourse.count({ where: liveWhere }),
  ]);
  const counts = { recorded: recordedTotal, live: liveTotal };

  if (tab === "recorded") {
    const packages = await prisma.package.findMany({ where: pkgWhere, orderBy: { order_by: "asc" }, skip, take });
    const plans = packages.length
      ? await prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: packages.map((p) => p.id) }, status: true } })
      : [];
    return {
      tab,
      recorded: packages.map((p) => toCategoryPackageDto(p, plans)),
      live: [] as any[],
      counts,
      total: recordedTotal,
    };
  }

  const liveCourses = await prisma.liveCourse.findMany({ where: liveWhere, orderBy: { ordered: "asc" }, skip, take });
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

// ── Admin CRUD ────────────────────────────────────────────────────────────────
// Optional search (title) + sort + pagination. skip/take omitted → full list.
export const listAll = async (q?: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) => {
  const where: any = {};
  const titleSearch = buildPrismaSearch(q?.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;
  const col = q?.sortBy === "title" ? "title" : q?.sortBy === "createdAt" ? "createdAt" : "order";
  // Newest-first tiebreaker so recently-added categories surface on top among
  // equal sort-key rows (the common case: most share order=0). `id desc` mirrors
  // the admin test-series / courses lists' "recently added on top" behavior.
  const orderBy: any[] = [{ [col]: q?.sortDir ?? "asc" }, { id: "desc" }];
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
  const row = await prisma.packageCategory.create({
    data: { title: input.title, slug: input.slug, image: input.image ?? null, order: input.order ?? 0, status: input.status ?? true },
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

// ── Client listing ──────────────────────────────────────────────────────────────
/** Active recorded-package count per category id. */
const packageCountFor = async (catIds: number[]): Promise<Map<number, number>> => {
  if (!catIds.length) return new Map();
  const rows = await prisma.package.groupBy({
    by: ["packageCategoryId"],
    where: { active: true, packageCategoryId: { in: catIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r: any) => [r.packageCategoryId as number, r._count._all as number]));
};

/** Active live-course count per category id (the `live[]` side of the detail). */
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
 * Client category listing with per-category count, optional title search + the
 * ?live=true filter. `packageCount` semantics mirror the category detail's two
 * arrays ({ recorded, live }):
 *   - live=false → recorded packages + live courses (the full category contents)
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
      prisma.packageCategory.findMany({ where, orderBy: { order: "asc" }, skip: opts.skip, take: opts.limitNum }),
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

  // live filter: keep only categories with ≥1 active live course, count = live count.
  const categories = await prisma.packageCategory.findMany({ where, orderBy: { order: "asc" } });
  const liveMap = await liveCourseCountFor(categories.map((c) => c.id));
  const filtered = categories.filter((c) => (liveMap.get(c.id) ?? 0) > 0);
  const total = filtered.length;
  const paged = filtered.slice(opts.skip, opts.skip + opts.limitNum);
  const data = paged.map((c) => ({ ...toPkgCatDto(c), packageCount: liveMap.get(c.id) ?? 0 }));
  return { data, pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
};
