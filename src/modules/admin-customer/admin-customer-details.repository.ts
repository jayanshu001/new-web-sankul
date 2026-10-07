// Admin customer details: Prisma queries for a customer's subscriptions and orders.
import { prisma } from "../../config/prisma";

/**
 * ws_package_course_subscription column mapping:
 *   package_id → the package (DTO `targetPackageId`)
 *   pcb_id     → the plan price row (DTO `packageId`, carries duration/price)
 */
export const adminCustomerDetailsRepository = {
  packageCourseSubs: (customerId: number) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  // `order` included: payment fields live on ws_live_course_order; the DTO falls back
  // to this row's legacy columns for pre-backfill rows.
  liveCourseSubs: (customerId: number) =>
    prisma.liveCourseSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, include: { order: true } }),
  testSeriesSubs: (customerId: number) =>
    prisma.testSeriesSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  ebookSubs: (customerId: number) =>
    prisma.eBookSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  bookOrders: (customerId: number) =>
    prisma.bookOrder.findMany({ where: { userId: customerId }, orderBy: { createdAt: "desc" } }),
  // `status: true` = not soft-deleted (address DELETE flips it to false); reads must
  // use this predicate or deleted rows reappear.
  addresses: (customerId: number) =>
    prisma.customerAddress.findMany({ where: { userId: customerId, status: true }, orderBy: { created_at: "desc" } }),

  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, level: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, duration: true, price: true } }) : Promise.resolve([]),
  liveCoursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  liveCoursePlansByIds: (ids: number[]) =>
    ids.length ? prisma.liveCoursePlan.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, duration: true, price: true } }) : Promise.resolve([]),
  testSeriesByIds: (ids: number[]) =>
    ids.length ? prisma.testSeries.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, thumbnail: true } }) : Promise.resolve([]),
  testSeriesPricesByIds: (ids: number[]) =>
    ids.length ? prisma.testSeriesPrice.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, durationDays: true, price: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, author: true, publisher: true, image: true, thumbnail: true } }) : Promise.resolve([]),
  ebookOrdersByIds: (ids: number[]) =>
    ids.length ? prisma.eBookOrder.findMany({ where: { id: { in: ids } }, select: { id: true, paymentMethod: true, orderPrice: true, status: true, createdAt: true } }) : Promise.resolve([]),
  statesByIds: (ids: number[]) =>
    ids.length ? prisma.customerState.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, state_code: true } }) : Promise.resolve([]),

  // Per-tab paginated lists. ws_package_course_subscription splits into courses
  // (course_id set) vs packages (course_id NULL, package_id set).
  countCourseSubs: (customerId: number, status?: boolean) =>
    prisma.packageCourseSubscription.count({ where: { customerId, courseId: { not: null }, ...(status !== undefined ? { status } : {}) } }),
  pageCourseSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { not: null }, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take }),

  countPackageSubs: (customerId: number, status?: boolean) =>
    prisma.packageCourseSubscription.count({ where: { customerId, courseId: null, packageId: { not: null }, ...(status !== undefined ? { status } : {}) } }),
  pagePackageSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: null, packageId: { not: null }, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take }),
  // Every row (id + window only) of the given products for this customer — the
  // Deactivate/Revert turn is decided across all of them, not just the current page.
  courseSubWindows: (customerId: number, courseIds: number[]) =>
    courseIds.length
      ? prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { in: courseIds } }, select: { id: true, courseId: true, startAt: true, endAt: true } })
      : Promise.resolve([]),
  packageSubWindows: (customerId: number, packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: null, packageId: { in: packageIds } }, select: { id: true, packageId: true, startAt: true, endAt: true } })
      : Promise.resolve([]),

  countLiveCourseSubs: (customerId: number, status?: boolean) =>
    prisma.liveCourseSubscription.count({ where: { customerId, ...(status !== undefined ? { status } : {}) } }),
  // `order` carries every payment field the DTO renders; without the join
  // paidAmount/discountAmount would be null.
  pageLiveCourseSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.liveCourseSubscription.findMany({ where: { customerId, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take, include: { order: true } }),

  liveCourseSubWindows: (customerId: number, liveCourseIds: number[]) =>
    liveCourseIds.length
      ? prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: liveCourseIds } }, select: { id: true, liveCourseId: true, startAt: true, endAt: true } })
      : Promise.resolve([]),

  countTestSeriesSubs: (customerId: number, status?: boolean) =>
    prisma.testSeriesSubscription.count({ where: { customerId, ...(status !== undefined ? { status } : {}) } }),
  pageTestSeriesSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.testSeriesSubscription.findMany({ where: { customerId, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take }),

  countEbookSubs: (customerId: number) =>
    prisma.eBookSubscription.count({ where: { customerId } }),
  pageEbookSubs: (customerId: number, skip: number, take: number) =>
    prisma.eBookSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, skip, take }),

  countBookOrders: (customerId: number) =>
    prisma.bookOrder.count({ where: { userId: customerId } }),
  pageBookOrders: (customerId: number, skip: number, take: number) =>
    prisma.bookOrder.findMany({ where: { userId: customerId }, orderBy: { createdAt: "desc" }, skip, take }),

  // Count and page must share the soft-delete predicate or the pagination envelope drifts.
  countAddresses: (customerId: number) =>
    prisma.customerAddress.count({ where: { userId: customerId, status: true } }),
  pageAddresses: (customerId: number, skip: number, take: number) =>
    prisma.customerAddress.findMany({ where: { userId: customerId, status: true }, orderBy: { created_at: "desc" }, skip, take }),
};
