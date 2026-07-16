import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

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

  // Test-series names for the (order-based) subscriptions rows.
  testSeriesByIds: (ids: number[]) =>
    ids.length ? prisma.testSeries.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, thumbnail: true } }) : Promise.resolve([]),

  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, packageTypeId: true } }) : Promise.resolve([]),
  packageTypesByIds: (ids: number[]) =>
    ids.length ? prisma.packageType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),

  // ── subscriptions tab: PURCHASE-ORDER based (each buy = one row) ──────────────
  // A validity extension FOLDS onto the entitlement subscription (unchanged — that
  // drives access/My-Subscriptions/reporting). But Purchase History must show every
  // purchase, so package/course + test-series list from their ORDER tables (each
  // completed order = a transaction). Live-course already lists per-purchase (its
  // retired extend rows stay payment_status="verified"), so it keeps its sub source.
  listPurchaseOrders: (customerId: number, skip: number, take: number) =>
    prisma.packageCourseOrder.findMany({
      where: { userId: customerId, status: "complete" },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countPurchaseOrders: (customerId: number) =>
    prisma.packageCourseOrder.count({ where: { userId: customerId, status: "complete" } }),
  /** plan rows for order display: course/package target + material flag + duration. */
  pcPlansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, courseId: true, packageId: true, withMaterial: true, duration: true } }) : Promise.resolve([]),
  /** flat shipment status rows keyed by the ORDER that created them (material orders only). */
  pcTrackingByOrderIds: (orderIds: number[]) =>
    orderIds.length ? prisma.packageCourseSubscriptionTracking.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, orderId: true, status: true, updated_at: true, created_at: true } }) : Promise.resolve([]),
  /** entitlement subscriptions (windows) for the given course/package targets, to
   *  decorate each order row with a validity window. Fresh orders map by order_id;
   *  extension orders fall back to the latest active sub for the same target. Scoped to
   *  the page's targets so a customer with many subs doesn't load them all. */
  pcSubsForTargets: (customerId: number, courseIds: number[], packageIds: number[]) =>
    courseIds.length || packageIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: {
            customerId,
            status: true,
            OR: [
              ...(courseIds.length ? [{ courseId: { in: courseIds } }] : []),
              ...(packageIds.length ? [{ packageId: { in: packageIds } }] : []),
            ],
          },
          select: { id: true, orderId: true, courseId: true, packageId: true, startAt: true, endAt: true },
        })
      : Promise.resolve([]),

  // Legacy purchases (pre-migration) exist as subscriptions with NO order row, so the
  // order-based list would drop them. Union them back in by listing active subs that
  // have no order_id — keyed by a distinct id prefix so receipt/tracking route to the
  // sub-based path. (SQL-native purchases + manual grants always have a complete order,
  // so they come only from the order list — no double-counting.)
  listOrderlessSubs: (customerId: number, skip: number, take: number) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, orderId: null },
      include: { packageCourseSubscriptionTracking: { select: { status: true } } },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countOrderlessSubs: (customerId: number) =>
    prisma.packageCourseSubscription.count({ where: { customerId, status: true, orderId: null } }),

  // test-series folds the same way → list from its order table too.
  listTestSeriesOrders: (customerId: number, skip: number, take: number) =>
    prisma.testSeriesOrder.findMany({ where: { customerId, status: "complete" }, orderBy: { id: "desc" }, skip, take }),
  countTestSeriesOrders: (customerId: number) =>
    prisma.testSeriesOrder.count({ where: { customerId, status: "complete" } }),
  listOrderlessTsSubs: (customerId: number, take: number) =>
    prisma.testSeriesSubscription.findMany({ where: { customerId, status: true, orderId: null }, orderBy: { id: "desc" }, take }),
  countOrderlessTsSubs: (customerId: number) =>
    prisma.testSeriesSubscription.count({ where: { customerId, status: true, orderId: null } }),
  tsSubsForSeries: (customerId: number, tsIds: number[]) =>
    tsIds.length
      ? prisma.testSeriesSubscription.findMany({ where: { customerId, status: true, testSeriesId: { in: tsIds } }, select: { orderId: true, testSeriesId: true, startAt: true, endAt: true } })
      : Promise.resolve([]),

  // ── books tab ──────────────────────────────────────────────────────────────
  // `search` filters on the order_items JSON text (a String column) — book names
  // live inside that JSON, so a LIKE over the raw text matches by book title.
  listBookOrders: (customerId: number, statuses: string[], skip: number, take: number, search?: string) =>
    prisma.bookOrder.findMany({
      where: { userId: customerId, status: { in: statuses }, ...(buildPrismaSearch(search, ["orderItems"]) ?? {}) },
      include: { BookTracking: { select: { tracking_id: true, status: true } } },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countBookOrders: (customerId: number, statuses: string[], search?: string) =>
    prisma.bookOrder.count({ where: { userId: customerId, status: { in: statuses }, ...(buildPrismaSearch(search, ["orderItems"]) ?? {}) } }),
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
    prisma.eBook.findMany({ where: buildPrismaSearch(search, ["name"]) ?? {}, select: { id: true } }),
  /** price (plan) ids linked to the given ebook ids (ws_ebook_order filters by plan_id). */
  planIdsByEbookIds: (ebookIds: number[]) =>
    ebookIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ebookIds } }, select: { id: true } }) : Promise.resolve([]),
  /** ebook order → plan → ebook (ws_ebook_order has no ebook_id). */
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, ebookId: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, author: true } }) : Promise.resolve([]),
  /** subscription start_at + ebook_id per order. start_at is the purchase-date proxy
   *  for legacy orders whose created_at is NULL; ebook_id resolves the ebook for
   *  plan-less orders (manual grants) where the order.plan_id → ebook hop is NULL. */
  ebookSubStartByOrderIds: (orderIds: number[]) =>
    orderIds.length ? prisma.eBookSubscription.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, startAt: true, ebookId: true } }) : Promise.resolve([]),

  // ── ebook receipt (single order, ownership-scoped) ───────────────────────────
  ebookOrderForReceipt: (orderId: number, customerId: number) =>
    prisma.eBookOrder.findFirst({ where: { id: orderId, userId: customerId } }),
  /** plan row carrying duration + the ebook hop (ws_ebook_order has no ebook_id). */
  planForReceipt: (planId: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id: planId }, select: { id: true, ebookId: true, duration: true } }),
  ebookById: (id: number) =>
    prisma.eBook.findFirst({ where: { id }, select: { id: true, name: true, author: true } }),
  /** ebook_id from the subscription for a plan-less order (manual grant with no plan_id). */
  ebookIdBySubForOrder: (orderId: number) =>
    prisma.eBookSubscription.findFirst({ where: { orderId }, select: { ebookId: true } }),

  // ── book receipt (single order, ownership-scoped) ────────────────────────────
  bookOrderForReceipt: (orderId: number, customerId: number) =>
    prisma.bookOrder.findFirst({
      where: { id: orderId, userId: customerId },
      include: { BookTracking: { select: { tracking_id: true, status: true } } },
    }),

  // ── course/package receipt + tracking (ORDER-based, ownership-scoped) ────────
  // Keyed by the ORDER id now surfaced as the purchase-history _id. The order row
  // carries amount + razorpay ids + the dispatch address directly (better parity than
  // the old sub→order hop). Includes CustomerShipping; the address may instead live in
  // ws_customer_address (see customerAddressById) — the service falls back.
  courseOrderByIdForReceipt: (orderId: number, customerId: number) =>
    prisma.packageCourseOrder.findFirst({
      where: { id: orderId, userId: customerId },
      include: { CustomerShipping: { select: { name: true, phone: true, city: true, address: true, pincode: true } } },
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

  // ── subscription material tracking (single subscription, ownership-scoped) ───
  /** package/course sub + its delivery address + flat shipment status row (material plans only). */
  subscriptionForTracking: (subId: number, customerId: number) =>
    prisma.packageCourseSubscription.findFirst({
      where: { id: subId, customerId, status: true },
      include: {
        customerShipping: { select: { name: true, phone: true, city: true, address: true, pincode: true } },
        packageCourseSubscriptionTracking: { select: { status: true, created_at: true, updated_at: true } },
      },
    }),
  /** verified live-course sub (AWB + status are inline columns; address is a separate table). */
  liveSubscriptionForTracking: (subId: number, customerId: number) =>
    prisma.liveCourseSubscription.findFirst({ where: { id: subId, customerId, paymentStatus: "verified" } }),
  /** delivery address for a live sub (customer_shipping_id → ws_customer_address). */
  customerAddressById: (id: number) =>
    prisma.customerAddress.findFirst({ where: { id }, select: { name: true, phone: true, city: true, address: true, pincode: true } }),

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
  /** completed test-series order (ORDER-based receipt, ownership-scoped). */
  testSeriesOrderByIdForReceipt: (orderId: number, customerId: number) =>
    prisma.testSeriesOrder.findFirst({ where: { id: orderId, customerId } }),
  testSeriesForReceipt: (id: number) =>
    prisma.testSeries.findFirst({ where: { id }, select: { id: true, title: true } }),
  /** test-series plan row carrying duration in DAYS (duration_days). */
  testSeriesPlanForReceipt: (planId: number) =>
    prisma.testSeriesPrice.findFirst({ where: { id: planId }, select: { id: true, durationDays: true } }),
};
