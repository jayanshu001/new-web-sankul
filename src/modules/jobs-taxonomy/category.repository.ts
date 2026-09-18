import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { CategoryCreateInput, CategoryUpdateInput } from "./category.types";

// A category scoped to an organization only shows for that organization; a
// category with no organization is shared/global and shows regardless.
const buildWhere = (search?: string, organizationId?: bigint) => {
  const searchWhere = buildPrismaSearch(search, ["label"]) ?? {};
  if (!organizationId) return searchWhere;
  return { ...searchWhere, OR: [{ organizationId }, { organizationId: null }] };
};

export const categoryRepository = {
  findPage: (opts: { search?: string; organizationId?: bigint; skip: number; take: number }) =>
    prisma.jobCategory.findMany({
      where: buildWhere(opts.search, opts.organizationId),
      include: { image: true, organization: true },
      orderBy: [{ sortOrder: "asc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  count: (search?: string, organizationId?: bigint) =>
    prisma.jobCategory.count({ where: buildWhere(search, organizationId) }),

  findById: (id: bigint) =>
    prisma.jobCategory.findUnique({ where: { id }, include: { image: true, organization: true } }),

  findBySlug: (slug: string) => prisma.jobCategory.findUnique({ where: { slug } }),

  create: (input: CategoryCreateInput & { slug: string }) =>
    prisma.jobCategory.create({
      data: {
        slug: input.slug,
        label: input.label,
        organizationId: input.organizationId ?? null,
        sortOrder: input.sortOrder ?? 0,
        imageMediaId: input.imageMediaId ?? undefined,
        showOnHome: input.showOnHome ?? false,
        isActive: input.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: { image: true, organization: true },
    }),

  update: (id: bigint, input: CategoryUpdateInput) =>
    prisma.jobCategory.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
        ...(input.showOnHome !== undefined ? { showOnHome: input.showOnHome } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      },
      include: { image: true, organization: true },
    }),

  delete: (id: bigint) => prisma.jobCategory.delete({ where: { id } }),

  reorder: (orders: { id: bigint; order: number }[]) =>
    prisma.$transaction(
      orders.map(({ id, order }) =>
        prisma.jobCategory.update({ where: { id }, data: { sortOrder: order } })
      )
    ),
};
