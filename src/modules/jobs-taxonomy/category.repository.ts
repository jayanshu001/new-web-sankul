import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { CategoryCreateInput, CategoryUpdateInput } from "./category.types";

const buildWhere = (search?: string) => buildPrismaSearch(search, ["label"]) ?? {};

export const categoryRepository = {
  findPage: (opts: { search?: string; skip: number; take: number }) =>
    prisma.jobCategory.findMany({
      where: buildWhere(opts.search),
      orderBy: [{ sortOrder: "asc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  count: (search?: string) => prisma.jobCategory.count({ where: buildWhere(search) }),

  findById: (id: bigint) => prisma.jobCategory.findUnique({ where: { id } }),

  findBySlug: (slug: string) => prisma.jobCategory.findUnique({ where: { slug } }),

  create: (input: CategoryCreateInput & { slug: string }) =>
    prisma.jobCategory.create({
      data: {
        slug: input.slug,
        label: input.label,
        sortOrder: input.sortOrder ?? 0,
        imageUrl: input.imageUrl ?? undefined,
        imageAlt: input.imageAlt ?? undefined,
        showOnHome: input.showOnHome ?? false,
        isActive: input.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  update: (id: bigint, input: CategoryUpdateInput) =>
    prisma.jobCategory.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.imageAlt !== undefined ? { imageAlt: input.imageAlt } : {}),
        ...(input.showOnHome !== undefined ? { showOnHome: input.showOnHome } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      },
    }),

  delete: (id: bigint) => prisma.jobCategory.delete({ where: { id } }),

  reorder: (orders: { id: bigint; order: number }[]) =>
    prisma.$transaction(
      orders.map(({ id, order }) =>
        prisma.jobCategory.update({ where: { id }, data: { sortOrder: order } })
      )
    ),
};
