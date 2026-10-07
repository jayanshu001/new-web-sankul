// Recently added: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Each source table has its own PK space, so the service over-fetches each table to
 * (skip+take), merges by created date desc, then slices the page.
 */
export const clientRecentlyAddedRepository = {
  /** The feed classifies Planner/Smart by type name. */
  allPackageTypes: () => prisma.packageType.findMany({ select: { id: true, name: true } }),

  recentPackagesByTypes: (typeIds: number[], search: string | null, take: number) =>
    typeIds.length
      ? prisma.package.findMany({
          where: { active: true, packageTypeId: { in: typeIds }, ...(buildPrismaSearch(search, ["name"]) ?? {}) },
          orderBy: { created_at: "desc" },
          take,
          include: { packageType: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
  countPackagesByTypes: (typeIds: number[], search: string | null) =>
    typeIds.length
      ? prisma.package.count({ where: { active: true, packageTypeId: { in: typeIds }, ...(buildPrismaSearch(search, ["name"]) ?? {}) } })
      : Promise.resolve(0),
  packagePlansByPackageIds: (ids: number[]) =>
    ids.length
      ? prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: ids }, status: true }, orderBy: { duration: "asc" } })
      : Promise.resolve([]),
  packageSubsForOwnership: (customerId: number, packageIds: number[], now: Date) =>
    packageIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: { customerId, status: true, packageId: { in: packageIds }, OR: [{ endAt: null }, { endAt: { gt: now } }] },
          select: { packageId: true, endAt: true },
        })
      : Promise.resolve([]),

  recentLiveCourses: (search: string | null, take: number) =>
    prisma.liveCourse.findMany({
      where: { status: true, ...(buildPrismaSearch(search, ["name"]) ?? {}) },
      orderBy: { createdAt: "desc" },
      take,
    }),
  countLiveCourses: (search: string | null) =>
    prisma.liveCourse.count({ where: { status: true, ...(buildPrismaSearch(search, ["name"]) ?? {}) } }),
};
