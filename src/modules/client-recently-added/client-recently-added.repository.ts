import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Prisma READ persistence for the client "Recently Added" feed. Combines two
 * package kinds (Planner / Smart, identified by package_type_id) with live
 * courses. Each source table has its own PK space, so the service over-fetches
 * each table to (skip+take), merges by created date desc, then slices the page.
 */
export const clientRecentlyAddedRepository = {
  // ── Package types ─────────────────────────────────────────────────────────
  /** All package types (id + name) — the feed classifies Planner/Smart by name. */
  allPackageTypes: () => prisma.packageType.findMany({ select: { id: true, name: true } }),

  // ── Packages (Planner / Smart) ────────────────────────────────────────────
  /** Newest active packages of the given type ids, incl. their type name. */
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
  /** Active price plans for the given packages (grouped by material in the service). */
  packagePlansByPackageIds: (ids: number[]) =>
    ids.length
      ? prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: ids }, status: true }, orderBy: { duration: "asc" } })
      : Promise.resolve([]),
  /** Active, non-expired package subscriptions for ownership + daysLeft decoration. */
  packageSubsForOwnership: (customerId: number, packageIds: number[], now: Date) =>
    packageIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: { customerId, status: true, packageId: { in: packageIds }, OR: [{ endAt: null }, { endAt: { gt: now } }] },
          select: { packageId: true, endAt: true },
        })
      : Promise.resolve([]),

  // ── Live courses ──────────────────────────────────────────────────────────
  /** Newest active live courses (createdAt desc). */
  recentLiveCourses: (search: string | null, take: number) =>
    prisma.liveCourse.findMany({
      where: { status: true, ...(buildPrismaSearch(search, ["name"]) ?? {}) },
      orderBy: { createdAt: "desc" },
      take,
    }),
  countLiveCourses: (search: string | null) =>
    prisma.liveCourse.count({ where: { status: true, ...(buildPrismaSearch(search, ["name"]) ?? {}) } }),
};
