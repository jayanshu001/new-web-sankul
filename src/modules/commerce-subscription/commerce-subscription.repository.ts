// Package/course subscriptions: Prisma queries for entitlement rows.
import { prisma } from "../../config/prisma";

/**
 * Entitlement source of truth. Naming: plan = SQL `pcb_id` (`planId`); package =
 * SQL `package_id` (`packageId`). Active = `status = true AND end_at > now`.
 */
export const commerceSubscriptionRepository = {
  findById: (id: number) =>
    prisma.packageCourseSubscription.findUnique({ where: { id } }),

  findActiveCourseSub: (customerId: number, courseId: number, now: Date) =>
    prisma.packageCourseSubscription.findFirst({
      where: {
        customerId,
        courseId,
        status: true,
        endAt: { gt: now },
      },
      orderBy: { endAt: "desc" },
    }),

  findActivePackageSub: (customerId: number, packageId: number, now: Date) =>
    prisma.packageCourseSubscription.findFirst({
      where: {
        customerId,
        packageId,
        status: true,
        endAt: { gt: now },
      },
      orderBy: { endAt: "desc" },
    }),

  listByCustomer: (customerId: number) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

  listActiveByCustomer: (customerId: number, now: Date) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      orderBy: [{ endAt: "desc" }, { id: "desc" }],
    }),

  /**
   * Includes lifetime grants (endAt null). The table has no payment-status
   * column, so `status = true` is the verified-entitlement gate.
   */
  listActiveForCoursesOrPlans: (
    customerId: number,
    courseIds: number[],
    planIds: number[],
    now: Date
  ) =>
    prisma.packageCourseSubscription.findMany({
      where: {
        customerId,
        status: true,
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        AND: [
          {
            OR: [
              ...(courseIds.length ? [{ courseId: { in: courseIds } }] : []),
              ...(planIds.length ? [{ planId: { in: planIds } }] : []),
            ],
          },
        ],
      },
      select: { courseId: true, planId: true, endAt: true },
    }),

  /** Throws P2025 if absent. */
  updateEndAt: (id: number, endAt: Date) =>
    prisma.packageCourseSubscription.update({ where: { id }, data: { endAt } }),

  /**
   * Batched `findActivePackageSub`; same predicate so `isPurchased` cannot
   * disagree between list and detail. Ordered `endAt ASC` so a Map built by
   * packageId keeps the latest-expiring row, matching the single-row query.
   */
  findActivePackageSubsForPackages: (customerId: number, packageIds: number[], now: Date) =>
    packageIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: {
            customerId,
            packageId: { in: packageIds },
            status: true,
            endAt: { gt: now },
          },
          select: { packageId: true, endAt: true },
          orderBy: { endAt: "asc" },
        })
      : Promise.resolve([]),

  countActiveByPackage: (packageId: number, now: Date) =>
    prisma.packageCourseSubscription.count({
      where: { packageId, status: true, endAt: { gt: now } },
    }),

  countActiveByCourse: (courseId: number, now: Date) =>
    prisma.packageCourseSubscription.count({
      where: { courseId, status: true, endAt: { gt: now } },
    }),
};
