import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the commerce · subscription READ branch
 * (`ws_package_course_subscription`, Phase 3a — READ-ONLY, flag OFF).
 *
 * This is the entitlement source of truth. The read predicates mirror the
 * dominant Mongo consumer queries exactly:
 *  - active-entitlement check: `{customerId, courseId|packageId, status:true,
 *    endAt: {$gt: now}}` (lecture/progress/lecture-note access gates)
 *  - list a customer's subscriptions (purchase-history / dashboard / my-subs)
 *  - active-owner counts (`countDocuments({packageId, status:true})`)
 *
 * SQL→Mongo name mapping (see types.ts): Mongo `packageId`=plan=SQL `pcb_id`
 * (`planId`); Mongo `targetPackageId`=package=SQL `package_id` (`packageId`).
 *
 * NO writes — subscription create/extend is Phase 3b (verify.controller).
 */
export const commerceSubscriptionRepository = {
  /** Single subscription by id. */
  findById: (id: number) =>
    prisma.packageCourseSubscription.findUnique({ where: { id } }),

  /**
   * Active, unexpired COURSE entitlement for a customer.
   * Mirrors `findOne({customerId, courseId, status:true, endAt:{$gt:now}})`.
   */
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

  /**
   * Active, unexpired PACKAGE entitlement for a customer.
   * `package_id` (SQL) = Mongo `targetPackageId` = the actual package.
   */
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

  /** All subscriptions for a customer, newest first (listing surfaces). */
  listByCustomer: (customerId: number) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

  /** Active subscriptions for a customer (status + unexpired), newest first. */
  listActiveByCustomer: (customerId: number, now: Date) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      orderBy: [{ endAt: "desc" }, { id: "desc" }],
    }),

  /**
   * Active subscriptions for a customer that match ANY of the given courses OR
   * plans, INCLUDING lifetime grants (endAt null). Mirrors the course-listing
   * purchase-state query:
   *   `{customerId, status:true, (endAt null OR > now),
   *     (courseId in courseIds OR planId in planIds)}`.
   * Returns only the fields needed to compute per-course daysLeft.
   *
   * NOTE: the Mongo query also filters `paymentStatus:"verified"`, but the SQL
   * table has no `payment_status` column (that concept is collapsed into
   * `status` — see commerce-subscription.types.ts). So `status=true` IS the
   * verified-entitlement gate here.
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

  /** Count active owners of a package (`package_id`, the actual package). */
  countActiveByPackage: (packageId: number, now: Date) =>
    prisma.packageCourseSubscription.count({
      where: { packageId, status: true, endAt: { gt: now } },
    }),

  /** Count active owners of a course. */
  countActiveByCourse: (courseId: number, now: Date) =>
    prisma.packageCourseSubscription.count({
      where: { courseId, status: true, endAt: { gt: now } },
    }),
};
