import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { OrganizationCreateInput, OrganizationUpdateInput } from "./organization.types";

const buildWhere = (search?: string) => buildPrismaSearch(search, ["name"]) ?? {};

export const organizationRepository = {
  findPage: (opts: { search?: string; skip: number; take: number }) =>
    prisma.jobOrganization.findMany({
      where: buildWhere(opts.search),
      orderBy: { id: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),

  count: (search?: string) => prisma.jobOrganization.count({ where: buildWhere(search) }),

  findById: (id: bigint) => prisma.jobOrganization.findUnique({ where: { id } }),

  findBySlug: (slug: string) => prisma.jobOrganization.findUnique({ where: { slug } }),

  create: (input: OrganizationCreateInput & { slug: string }) =>
    prisma.jobOrganization.create({
      data: {
        name: input.name,
        slug: input.slug,
        logoUrl: input.logoUrl ?? undefined,
        logoAlt: input.logoAlt ?? undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  update: (id: bigint, input: OrganizationUpdateInput) =>
    prisma.jobOrganization.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.logoAlt !== undefined ? { logoAlt: input.logoAlt } : {}),
        updatedAt: new Date(),
      },
    }),

  delete: (id: bigint) => prisma.jobOrganization.delete({ where: { id } }),
};
