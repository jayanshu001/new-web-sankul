// Package catalog: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

export const catalogPackageRepository = {
  /** `ws_package_type` has no `order` column, so types are ordered by name, then id. */
  listPackageTypes: (opts?: { search?: string; skip?: number; take?: number }) =>
    prisma.packageType.findMany({
      where: buildPrismaSearch(opts?.search, ["name"]) ?? {},
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: opts?.skip,
      take: opts?.take,
    }),

  countPackageTypes: (opts?: { search?: string }) =>
    prisma.packageType.count({
      where: buildPrismaSearch(opts?.search, ["name"]) ?? {},
    }),

  findPackageById: (id: number) =>
    prisma.package.findFirst({ where: { id, active: true } }),

  listActivePackages: (opts?: { search?: string }) =>
    prisma.package.findMany({
      where: {
        active: true,
        ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
      },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    }),

  listActivePackagesByType: (packageTypeId: number) =>
    prisma.package.findMany({
      where: { active: true, packageTypeId },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    }),
};
