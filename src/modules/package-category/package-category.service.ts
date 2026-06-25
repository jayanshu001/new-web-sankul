/**
 * PackageCategory — dual-path SQL/Mongo. Net-new SQL table ws_package_category
 * (2026-06-19), backfilled from Mongo ws_package_categories. Gated behind
 * `isMysqlModule("package-category")`.
 *
 * Scope: admin CRUD (list/create/update/delete) + the client category LISTING
 * (`listPackageCategories`, with per-category active-package count + the
 * ?live=true filter) + the client `listPackagesByCategory` detail join
 * (`listPackagesAndLiveByCategory`). The detail join is now SQL-backed:
 * ws_package carries is_paid/is_smart_course/is_planner_course and
 * ws_live_course carries package_category_id, so packages + live courses for a
 * category resolve entirely on MySQL.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const PACKAGE_CATEGORY_MODULE = "package-category";
export const isPackageCategoryMysql = (): boolean => isMysqlModule(PACKAGE_CATEGORY_MODULE);

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
    isSmartCourse: p.isSmartCourse,
    isPlannerCourse: p.isPlannerCourse,
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

// ws_live_course row → the Mongo `live[]` shape (courseEducatorId ← educator_id).
const toCategoryLiveDto = (c: any) => ({
  _id: String(c.id),
  name: c.name,
  description: c.description ?? null,
  image: c.image ?? null,
  shareableLink: c.shareableLink ?? null,
  ordered: c.ordered,
  isPaid: c.isPaid,
  isPopular: c.isPopular,
  level: c.level ?? null,
  classType: c.classType,
  withMaterial: c.withMaterial ?? null,
  withoutMaterial: c.withoutMaterial ?? null,
  courseEducatorId: idStr(c.educatorId),
});

/**
 * GET /client/package-categories/:id → { recorded, live }. Active packages (with
 * plans/defaultPlan/startingPrice) and active live courses in this package
 * category. No category existence check / 404 — mirrors the Mongo handler, which
 * returns empty arrays for an unknown id.
 */
export const listPackagesAndLiveByCategory = async (categoryId: number) => {
  const [packages, liveCourses] = await Promise.all([
    prisma.package.findMany({ where: { active: true, packageCategoryId: categoryId }, orderBy: { order_by: "asc" } }),
    prisma.liveCourse.findMany({ where: { status: true, packageCategoryId: categoryId }, orderBy: { ordered: "asc" } }),
  ]);
  const plans = packages.length
    ? await prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: packages.map((p) => p.id) }, status: true } })
    : [];
  return {
    recorded: packages.map((p) => toCategoryPackageDto(p, plans)),
    live: liveCourses.map(toCategoryLiveDto),
  };
};

// ── Admin CRUD ────────────────────────────────────────────────────────────────
// Optional search (title) + sort + pagination. skip/take omitted → full list.
export const listAll = async (q?: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) => {
  const where: any = {};
  if (q?.search) where.title = { contains: q.search.trim() };
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
/** Active-package count per category id (mirrors the Mongo aggregation). */
const packageCountFor = async (catIds: number[]): Promise<Map<number, number>> => {
  if (!catIds.length) return new Map();
  const rows = await prisma.package.groupBy({
    by: ["packageCategoryId"],
    where: { active: true, packageCategoryId: { in: catIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r: any) => [r.packageCategoryId as number, r._count._all as number]));
};

/** Category ids that have ≥1 active LiveCourse (the ?live=true filter). */
const liveCategoryIdSet = async (catIds: number[]): Promise<Set<number>> => {
  if (!catIds.length) return new Set();
  const rows = await prisma.liveCourse.findMany({
    where: { status: true, packageCategoryId: { in: catIds } },
    select: { packageCategoryId: true },
    distinct: ["packageCategoryId"],
  });
  return new Set(rows.map((r) => r.packageCategoryId!).filter((x) => x != null));
};

/**
 * Client category listing with per-category active-package count, optional
 * title search + the ?live=true filter. Returns { data, pagination } matching
 * the Mongo handler exactly.
 */
export const listClientPackageCategories = async (opts: {
  liveOnly: boolean; search: string | null; skip: number; limitNum: number; pageNum: number;
}) => {
  const where: any = { status: true };
  if (opts.search) where.title = { contains: opts.search };

  if (!opts.liveOnly) {
    const [rawList, total] = await Promise.all([
      prisma.packageCategory.findMany({ where, orderBy: { order: "asc" }, skip: opts.skip, take: opts.limitNum }),
      prisma.packageCategory.count({ where }),
    ]);
    const countMap = await packageCountFor(rawList.map((c) => c.id));
    const data = rawList.map((c) => ({ ...toPkgCatDto(c), packageCount: countMap.get(c.id) ?? 0 }));
    return { data, pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
  }

  // live filter: compute across the full matching set, then page.
  const categories = await prisma.packageCategory.findMany({ where, orderBy: { order: "asc" } });
  const liveSet = await liveCategoryIdSet(categories.map((c) => c.id));
  const filtered = categories.filter((c) => liveSet.has(c.id));
  const total = filtered.length;
  const paged = filtered.slice(opts.skip, opts.skip + opts.limitNum);
  const countMap = await packageCountFor(paged.map((c) => c.id));
  const data = paged.map((c) => ({ ...toPkgCatDto(c), packageCount: countMap.get(c.id) ?? 0 }));
  return { data, pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
};
