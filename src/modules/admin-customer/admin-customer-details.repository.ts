import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the admin customer-details aggregate (MySQL branch).
 * Read-only aggregation over already-migrated subscription/order tables — no new
 * tables. Each subscription type is fetched for the customer, then its foreign
 * references (course/package/plan/ebook/book/state names) are hydrated by id so
 * the transformer can emit the same populated DTO the Mongo handler returned.
 *
 * ⚠ ws_package_course_subscription column mapping (inverted vs Mongo):
 *   package_id → the PACKAGE (Mongo `targetPackageId`)
 *   pcb_id     → the PLAN price row (Mongo `packageId`, carries duration/price)
 */
export const adminCustomerDetailsRepository = {
  // ── subscriptions / orders for the customer (newest first) ──────────────────
  packageCourseSubs: (customerId: number) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  liveCourseSubs: (customerId: number) =>
    prisma.liveCourseSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  testSeriesSubs: (customerId: number) =>
    prisma.testSeriesSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  ebookSubs: (customerId: number) =>
    prisma.eBookSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),
  bookOrders: (customerId: number) =>
    prisma.bookOrder.findMany({ where: { userId: customerId }, orderBy: { createdAt: "desc" } }),
  // `status: true` = not soft-deleted. DELETE /admin/subscriptions/customer-addresses/:id
  // flips status to false; these reads must match that predicate or deleted rows reappear.
  addresses: (customerId: number) =>
    prisma.customerAddress.findMany({ where: { userId: customerId, status: true }, orderBy: { created_at: "desc" } }),

  // ── hydration (by id) ───────────────────────────────────────────────────────
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
  bookOrderItemsByReceipts: (receiptIds: string[]) =>
    receiptIds.length ? prisma.bookOrderItem.findMany({ where: { order_id: { in: receiptIds } } }) : Promise.resolve([]),
  booksByIds: (ids: number[]) =>
    ids.length ? prisma.book.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  statesByIds: (ids: number[]) =>
    ids.length ? prisma.customerState.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, state_code: true } }) : Promise.resolve([]),

  // ── per-tab paginated lists (server-side page/limit for the admin detail view) ─
  // The combined ws_package_course_subscription is split into courses (rows with a
  // course_id) vs packages (course_id NULL, package_id set), mirroring the aggregate.
  countCourseSubs: (customerId: number, status?: boolean) =>
    prisma.packageCourseSubscription.count({ where: { customerId, courseId: { not: null }, ...(status !== undefined ? { status } : {}) } }),
  pageCourseSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { not: null }, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take }),

  countPackageSubs: (customerId: number, status?: boolean) =>
    prisma.packageCourseSubscription.count({ where: { customerId, courseId: null, packageId: { not: null }, ...(status !== undefined ? { status } : {}) } }),
  pagePackageSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: null, packageId: { not: null }, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take }),

  countLiveCourseSubs: (customerId: number, status?: boolean) =>
    prisma.liveCourseSubscription.count({ where: { customerId, ...(status !== undefined ? { status } : {}) } }),
  pageLiveCourseSubs: (customerId: number, skip: number, take: number, status?: boolean) =>
    prisma.liveCourseSubscription.findMany({ where: { customerId, ...(status !== undefined ? { status } : {}) }, orderBy: { createdAt: "desc" }, skip, take }),

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

  // Soft-delete aware (see `addresses` above). Count and page MUST share the same
  // predicate, otherwise the pagination envelope drifts from the rows returned.
  countAddresses: (customerId: number) =>
    prisma.customerAddress.count({ where: { userId: customerId, status: true } }),
  pageAddresses: (customerId: number, skip: number, take: number) =>
    prisma.customerAddress.findMany({ where: { userId: customerId, status: true }, orderBy: { created_at: "desc" }, skip, take }),
};
