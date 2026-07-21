import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const PERMISSION_CATEGORY_MODULE = "permission-category";

export const isPermissionCategoryMysql = (): boolean => true;

export const parsePcatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export interface PermissionCategoryDto {
  id: string;
  title: string;
  slug: string;
  order: number;
  status: boolean;
  permission_count?: number;
  created_at: Date | null;
  updated_at: Date | null;
}

type PermissionCategoryRowLike = {
  id: number;
  title: string;
  slug: string;
  orderBy: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const toDto = (
  r: PermissionCategoryRowLike,
  count?: number
): PermissionCategoryDto => ({
  id: String(r.id),
  title: r.title,
  slug: r.slug,
  order: r.orderBy,
  status: r.status,
  ...(count !== undefined ? { permission_count: count } : {}),
  created_at: r.createdAt,
  updated_at: r.updatedAt,
});

const SORT_FIELD_MAP: Record<string, "id" | "title" | "orderBy" | "createdAt" | "updatedAt"> = {
  id: "id",
  title: "title",
  order: "orderBy",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

export interface ListCategoriesOpts {
  search?: string;
  status?: boolean;
  page: number;
  per_page: number;
  sortBy: string;
  sortDir: "asc" | "desc";
}

export interface ListCategoriesResult {
  items: PermissionCategoryDto[];
  pagination: { page: number; per_page: number; total: number };
}

export const listCategories = async (
  opts: ListCategoriesOpts
): Promise<ListCategoriesResult> => {
  const { search, status, page, per_page, sortBy, sortDir } = opts;

  const where: any = {};
  if (typeof status === "boolean") where.status = status;
  const titleSearch = buildPrismaSearch(search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;

  const orderField = SORT_FIELD_MAP[sortBy] ?? "orderBy";
  const skip = (page - 1) * per_page;

  const [rows, total] = await Promise.all([
    prisma.permissionCategoryRow.findMany({
      where,
      orderBy: { [orderField]: sortDir },
      skip,
      take: per_page,
    }),
    prisma.permissionCategoryRow.count({ where }),
  ]);

  const ids = rows.map((r) => r.id);
  const countMap = new Map<number, number>();
  if (ids.length) {
    const grouped = await prisma.adminPermissionRow.groupBy({
      by: ["categoryId"],
      where: { categoryId: { in: ids } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.categoryId != null) countMap.set(g.categoryId, g._count._all);
    }
  }

  return {
    items: rows.map((r) => toDto(r, countMap.get(r.id) ?? 0)),
    pagination: { page, per_page, total },
  };
};

export const getCategory = async (
  id: number
): Promise<PermissionCategoryDto | null> => {
  const row = await prisma.permissionCategoryRow.findUnique({ where: { id } });
  if (!row) return null;
  const count = await prisma.adminPermissionRow.count({
    where: { categoryId: id },
  });
  return toDto(row, count);
};

export interface CreateCategoryInput {
  title: string;
  slug: string;
  order: number;
  status: boolean;
}

export type CreateCategoryResult =
  | { ok: true; data: PermissionCategoryDto }
  | { ok: false; code: "slug_exists" };

export const createCategory = async (
  input: CreateCategoryInput
): Promise<CreateCategoryResult> => {
  const exists = await prisma.permissionCategoryRow.findFirst({
    where: { slug: input.slug },
  });
  if (exists) return { ok: false, code: "slug_exists" };

  const now = new Date();
  const row = await prisma.permissionCategoryRow.create({
    data: {
      title: input.title,
      slug: input.slug,
      orderBy: input.order,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { ok: true, data: toDto(row, 0) };
};

export interface UpdateCategoryInput {
  title?: string;
  slug?: string;
  order?: number;
  status?: boolean;
}

export type UpdateCategoryResult =
  | { ok: true; data: PermissionCategoryDto }
  | { ok: false; code: "not_found" | "slug_exists" };

export const updateCategory = async (
  id: number,
  input: UpdateCategoryInput
): Promise<UpdateCategoryResult> => {
  const existing = await prisma.permissionCategoryRow.findUnique({
    where: { id },
  });
  if (!existing) return { ok: false, code: "not_found" };

  if (input.slug && input.slug !== existing.slug) {
    const dupe = await prisma.permissionCategoryRow.findFirst({
      where: { slug: input.slug, id: { not: id } },
    });
    if (dupe) return { ok: false, code: "slug_exists" };
  }

  const data: any = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.order !== undefined) data.orderBy = input.order;
  if (input.status !== undefined) data.status = input.status;

  const row = await prisma.permissionCategoryRow.update({
    where: { id },
    data,
  });
  const count = await prisma.adminPermissionRow.count({
    where: { categoryId: id },
  });
  return { ok: true, data: toDto(row, count) };
};

export type DeleteCategoryResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "in_use" };

export const deleteCategory = async (
  id: number
): Promise<DeleteCategoryResult> => {
  const existing = await prisma.permissionCategoryRow.findUnique({
    where: { id },
  });
  if (!existing) return { ok: false, code: "not_found" };

  const inUse = await prisma.adminPermissionRow.findFirst({
    where: { categoryId: id },
  });
  if (inUse) return { ok: false, code: "in_use" };

  await prisma.permissionCategoryRow.delete({ where: { id } });
  return { ok: true };
};
