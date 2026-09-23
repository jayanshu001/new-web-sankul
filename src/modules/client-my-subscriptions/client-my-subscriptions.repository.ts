import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the client my-subscriptions MySQL branch (Wave 7).
 * Read-aggregation over already-migrated tables; no new tables. Covers the
 * `course` (course+package) and `ebook` tabs. The `test_series` tab is Mongo-only
 * (ws_test_series* has no SQL table) — it falls through to the Mongo controller.
 *
 * "Active" = status=true && endAt > now. ⚠ ws_package_course_subscription has no
 * payment_status → status conveys verified/active. SQL package_id = the package
 * (pcb_id = the plan); the Mongo handler inverts packageId/targetPackageId.
 */
export const clientMySubscriptionsRepository = {
  // course + package: ALL active rows (latest endAt first) for dedup-before-page.
  activeCourseSubs: (customerId: number, now: Date) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  // ebook: ALL active rows (latest endAt first).
  activeEbookSubs: (customerId: number, now: Date) =>
    prisma.eBookSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  // live courses: ALL active rows (latest endAt first). Unlike course/package/ebook,
  // a live-course sub can be LIFETIME (endAt = null) — include those (they never
  // expire) alongside not-yet-expired rows.
  //
  // The `payment_status = "verified"` filter was dropped 2026-08-25: payment moved to
  // ws_live_course_order and a subscription row is now written ONLY for a completed
  // order, so `status` is the ownership gate. Legacy rows that never verified were
  // deactivated by the backfill, so they stay excluded.
  activeLiveCourseSubs: (customerId: number, now: Date) =>
    prisma.liveCourseSubscription.findMany({
      where: {
        customerId,
        status: true,
        OR: [{ endAt: null }, { endAt: { gt: now } }],
      },
      orderBy: { endAt: "desc" },
    }),

  // hydration
  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, packageTypeId: true } }) : Promise.resolve([]),
  packageTypesByIds: (ids: number[]) =>
    ids.length ? prisma.packageType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, packageId: true, duration: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, author: true, image: true, thumbnail: true } }) : Promise.resolve([]),
  liveCoursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  livePlansByIds: (ids: number[]) =>
    ids.length ? prisma.liveCoursePlan.findMany({ where: { id: { in: ids } }, select: { id: true, duration: true } }) : Promise.resolve([]),
};
