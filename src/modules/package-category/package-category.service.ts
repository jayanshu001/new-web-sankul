/**
 * PackageCategory — dual-path SQL/Mongo. Net-new SQL table ws_package_category
 * (2026-06-19), backfilled from Mongo ws_package_categories. Gated behind
 * `isMysqlModule("package-category")`.
 *
 * Scope: admin CRUD (list/create/update/delete) + the client category LISTING
 * (`listPackageCategories`, with per-category active-package count + the
 * ?live=true filter). The client `listPackagesByCategory` detail join stays
 * Mongo — it returns Mongo-only Package fields (isSmartCourse/isPlannerCourse/…)
 * that ws_package does not carry (documented catalog drift).
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

// ── Admin CRUD ────────────────────────────────────────────────────────────────
// Optional search (title) + sort + pagination. skip/take omitted → full list.
export const listAll = async (q?: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) => {
  const where: any = {};
  if (q?.search) where.title = { contains: q.search.trim() };
  const col = q?.sortBy === "title" ? "title" : q?.sortBy === "createdAt" ? "createdAt" : "order";
  const orderBy: any[] = [{ [col]: q?.sortDir ?? "asc" }, { id: "asc" }];
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
