import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the client purchase-history MySQL branch (Wave 7).
 * Pure read-aggregation over ALREADY-MIGRATED tables — no new tables:
 *  - subscriptions tab → ws_package_course_subscription (+ package/course/type)
 *  - books tab         → ws_book_order (+ order_items JSON, book thumbnails)
 *  - ebooks tab        → ws_ebook_order (+ plan→ebook hop for title/thumb)
 *
 * ⚠ Drift vs Mongo (documented in the service):
 *  - ws_package_course_subscription has NO payment_status col → the Mongo
 *    "paymentStatus:verified" filter maps to status=true (active) here.
 *  - SQL package_id = the real package (pcb_id = the plan); the Mongo handler's
 *    packageId/targetPackageId are inverted — we resolve package_id directly.
 *  - ws_ebook_order has NO ebook_id → resolve ebook via plan_id → price → ebook.
 *  - ws_book_order items live in the order_items JSON (no embedded array);
 *    tracking courier is not stored (ws_book_tracking is a flat status row).
 */
export const clientPurchaseHistoryRepository = {
  // ── subscriptions tab ────────────────────────────────────────────────────
  listSubscriptions: (customerId: number, skip: number, take: number) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countSubscriptions: (customerId: number) =>
    prisma.packageCourseSubscription.count({ where: { customerId, status: true } }),

  // Live-course subscriptions live in their OWN single-table (ws_live_course_subscription
  // carries payment + entitlement together — see live-course-order.service). They are
  // NOT in ws_package_course_subscription, so the subscriptions tab must union them in.
  // "Purchased" for live = payment_status="verified" (pending rows are unpaid).
  listLiveSubscriptions: (customerId: number, take: number) =>
    prisma.liveCourseSubscription.findMany({
      where: { customerId, paymentStatus: "verified" },
      orderBy: { id: "desc" },
      take,
    }),
  countLiveSubscriptions: (customerId: number) =>
    prisma.liveCourseSubscription.count({ where: { customerId, paymentStatus: "verified" } }),
  liveCoursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),

  // Test-series subscriptions live in their OWN single-table
  // (ws_test_series_subscription), separate from package/live subs. "Purchased" =
  // status=true (active). Unioned into the subscriptions tab like live subs.
  listTestSeriesSubscriptions: (customerId: number, take: number) =>
    prisma.testSeriesSubscription.findMany({
      where: { customerId, status: true },
      orderBy: { id: "desc" },
      take,
    }),
  countTestSeriesSubscriptions: (customerId: number) =>
    prisma.testSeriesSubscription.count({ where: { customerId, status: true } }),
  testSeriesByIds: (ids: number[]) =>
    ids.length ? prisma.testSeries.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, thumbnail: true } }) : Promise.resolve([]),

  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, packageTypeId: true } }) : Promise.resolve([]),
  packageTypesByIds: (ids: number[]) =>
    ids.length ? prisma.packageType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),

  // ── books tab ──────────────────────────────────────────────────────────────
  // `search` filters on the order_items JSON text (a String column) — book names
  // live inside that JSON, so a LIKE over the raw text matches by book title.
  listBookOrders: (customerId: number, statuses: string[], skip: number, take: number, search?: string) =>
    prisma.bookOrder.findMany({
      where: { userId: customerId, status: { in: statuses }, ...(search ? { orderItems: { contains: search } } : {}) },
      include: { BookTracking: { select: { tracking_id: true, status: true } } },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countBookOrders: (customerId: number, statuses: string[], search?: string) =>
    prisma.bookOrder.count({ where: { userId: customerId, status: { in: statuses }, ...(search ? { orderItems: { contains: search } } : {}) } }),
  booksByIds: (ids: number[]) =>
    ids.length ? prisma.book.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, image: true } }) : Promise.resolve([]),

  // ── ebooks tab ───────────────────────────────────────────────────────────────
  // ws_ebook_order has no ebook_id and no title column, so name search is resolved
  // upstream (ebook name → price ids) and passed in as `planIds` to constrain here.
  listEbookOrders: (customerId: number, status: string, skip: number, take: number, planIds?: number[]) =>
    prisma.eBookOrder.findMany({
      where: { userId: customerId, status: status as any, ...(planIds ? { planId: { in: planIds } } : {}) },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countEbookOrders: (customerId: number, status: string, planIds?: number[]) =>
    prisma.eBookOrder.count({ where: { userId: customerId, status: status as any, ...(planIds ? { planId: { in: planIds } } : {}) } }),
  /** ebook ids whose name matches the search text (name-search entry point). */
  ebookIdsByName: (search: string) =>
    prisma.eBook.findMany({ where: { name: { contains: search } }, select: { id: true } }),
  /** price (plan) ids linked to the given ebook ids (ws_ebook_order filters by plan_id). */
  planIdsByEbookIds: (ebookIds: number[]) =>
    ebookIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ebookIds } }, select: { id: true } }) : Promise.resolve([]),
  /** ebook order → plan → ebook (ws_ebook_order has no ebook_id). */
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, ebookId: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, author: true } }) : Promise.resolve([]),
  /** subscription start_at per order (proxy for purchase date on legacy orders whose created_at is NULL). */
  ebookSubStartByOrderIds: (orderIds: number[]) =>
    orderIds.length ? prisma.eBookSubscription.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, startAt: true } }) : Promise.resolve([]),

  // ── ebook receipt (single order, ownership-scoped) ───────────────────────────
  ebookOrderForReceipt: (orderId: number, customerId: number) =>
    prisma.eBookOrder.findFirst({ where: { id: orderId, userId: customerId } }),
  /** plan row carrying duration + the ebook hop (ws_ebook_order has no ebook_id). */
  planForReceipt: (planId: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id: planId }, select: { id: true, ebookId: true, duration: true } }),
  ebookById: (id: number) =>
    prisma.eBook.findFirst({ where: { id }, select: { id: true, name: true, author: true } }),

  // ── book receipt (single order, ownership-scoped) ────────────────────────────
  bookOrderForReceipt: (orderId: number, customerId: number) =>
    prisma.bookOrder.findFirst({
      where: { id: orderId, userId: customerId },
      include: { BookTracking: { select: { tracking_id: true, status: true } } },
    }),

  // ── course/package receipt (single subscription, ownership-scoped) ───────────
  /** active subscription (status=true mirrors Mongo's paymentStatus:"verified"). */
  subscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.packageCourseSubscription.findFirst({ where: { id: subId, customerId, status: true } }),
  /** plan row carrying duration (pcb_id on the subscription). */
  planDurationForReceipt: (planId: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id: planId }, select: { id: true, duration: true } }),
  courseForReceipt: (id: number) =>
    prisma.course.findFirst({ where: { id }, select: { id: true, name: true } }),
  packageForReceipt: (id: number) =>
    prisma.package.findFirst({ where: { id }, select: { id: true, name: true } }),
  /** razorpay ids via the order hop (no razorpay cols on the subscription). */
  courseOrderForReceipt: (id: number) =>
    prisma.packageCourseOrder.findFirst({ where: { id }, select: { gatewayOrderId: true, gatewayPaymentId: true } }),

  // ── live-course receipt (single subscription, ownership-scoped) ──────────────
  /** verified live-course sub (single-table carries payment fields inline). */
  liveSubscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.liveCourseSubscription.findFirst({ where: { id: subId, customerId, paymentStatus: "verified" } }),
  liveCourseForReceipt: (id: number) =>
    prisma.liveCourse.findFirst({ where: { id }, select: { id: true, name: true } }),
  /** live-course plan row carrying duration (DAYS — see live-course-order.service). */
  livePlanForReceipt: (planId: number) =>
    prisma.liveCoursePlan.findFirst({ where: { id: planId }, select: { id: true, duration: true } }),

  // ── test-series receipt (single subscription, ownership-scoped) ──────────────
  /** active test-series sub (status=true mirrors "verified"). */
  testSeriesSubscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.testSeriesSubscription.findFirst({ where: { id: subId, customerId, status: true } }),
  testSeriesForReceipt: (id: number) =>
    prisma.testSeries.findFirst({ where: { id }, select: { id: true, title: true } }),
  /** test-series plan row carrying duration in DAYS (duration_days). */
  testSeriesPlanForReceipt: (planId: number) =>
    prisma.testSeriesPrice.findFirst({ where: { id: planId }, select: { id: true, durationDays: true } }),
  /** razorpay ids + method via the order hop (ws_test_series_subscription has no razorpay cols). */
  testSeriesOrderForReceipt: (id: number) =>
    prisma.testSeriesOrder.findFirst({ where: { id }, select: { razorpayOrderId: true, razorpayPaymentId: true, paymentMethod: true } }),
};
