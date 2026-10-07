// Client my subscriptions: Prisma queries.
import { prisma } from "../../config/prisma";

/**
 * "Active" = status=true && endAt > now. ws_package_course_subscription has no
 * payment_status, so status conveys verified/active. package_id = the package; pcb_id = the plan.
 */
export const clientMySubscriptionsRepository = {
  // All active rows (latest endAt first) so the service can dedup before paging.
  activeCourseSubs: (customerId: number, now: Date) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  activeEbookSubs: (customerId: number, now: Date) =>
    prisma.eBookSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  // Unlike course/package/ebook, a live-course sub can be lifetime (endAt = null).
  // Payment lives on ws_live_course_order and a subscription row is written only for a
  // completed order, so `status` is the ownership gate (no payment_status filter).
  activeLiveCourseSubs: (customerId: number, now: Date) =>
    prisma.liveCourseSubscription.findMany({
      where: {
        customerId,
        status: true,
        OR: [{ endAt: null }, { endAt: { gt: now } }],
      },
      orderBy: { endAt: "desc" },
    }),

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
