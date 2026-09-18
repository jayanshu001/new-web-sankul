import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { OrganizationCreateInput, OrganizationUpdateInput } from "./organization.types";

const buildWhere = (search?: string) => buildPrismaSearch(search, ["name"]) ?? {};

export const organizationRepository = {
  findPage: (opts: { search?: string; skip: number; take: number }) =>
    prisma.jobOrganization.findMany({
      where: buildWhere(opts.search),
      include: { logo: true },
      orderBy: { id: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),

  count: (search?: string) => prisma.jobOrganization.count({ where: buildWhere(search) }),

  findById: (id: bigint) =>
    prisma.jobOrganization.findUnique({ where: { id }, include: { logo: true } }),

  findBySlug: (slug: string) => prisma.jobOrganization.findUnique({ where: { slug } }),

  create: (input: OrganizationCreateInput & { slug: string }) =>
    prisma.jobOrganization.create({
      data: {
        name: input.name,
        slug: input.slug,
        logoMediaId: input.logoMediaId ?? undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: { logo: true },
    }),

  update: (id: bigint, input: OrganizationUpdateInput) =>
    prisma.jobOrganization.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.logoMediaId !== undefined ? { logoMediaId: input.logoMediaId } : {}),
        updatedAt: new Date(),
      },
      include: { logo: true },
    }),

  delete: (id: bigint) => prisma.jobOrganization.delete({ where: { id } }),
};
