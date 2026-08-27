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
  // Live-course subscriptions are NOT in ws_package_course_subscription, so the
  // subscriptions tab must union them in separately.
  //
  // Kept keyed on the SUBSCRIPTION (not the order, unlike the package/course and
  // test-series tabs) because the emitted `lc_`-prefixed `_id` IS the subscription id,
  // and the receipt + tracking resolvers below look rows up by it. Since 2026-08-25
  // subscription rows are 1:1 with orders, so this still yields exactly one row per
  // purchase — a renewal now appears as its own line instead of folding away.
  //
  // "Purchased" is the ORDER's status. The old `payment_status` column is gone
  // (2026-08-25_live_course_subscription_drop_payment_columns.sql) and the backfill
  // gave every legacy row an order carrying its original state, so there is no
  // pre-backfill branch left — an unlinked row is not a purchase.
  liveSubscriptionPurchasedWhere: (customerId: number) => ({
    customerId,
    order: { status: "complete" },
  }),
  // `order` is included because the listing emits `amount` + the razorpay ids, all of
  // which moved off the subscription on 2026-08-25.
  listLiveSubscriptions: (customerId: number, take: number) =>
    prisma.liveCourseSubscription.findMany({
      where: clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId),
      orderBy: { id: "desc" },
      take,
      // `trackingRow` carries the dispatch status since 2026-08-27 (c) — it moved off
      // the subscription into ws_live_course_subscription_tracking.
      include: { order: true, trackingRow: { select: { status: true } } },
    }),
  countLiveSubscriptions: (customerId: number) =>
    prisma.liveCourseSubscription.count({ where: clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId) }),
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
  /** Columns the subscriptions list needs off an entitlement subscription (the
   *  validity window + enough key material to match it back to an order/target). */
  PC_SUB_WINDOW_SELECT: { id: true, orderId: true, courseId: true, packageId: true, startAt: true, endAt: true } as const,
  /**
   * Validity window for the page's OWN orders — the common case since one order =
   * one subscription row (2026-08-25). `order_id IN (…)` rides
   * idx_pcs_customer_status_order as an index range scan, so this reads at most one
   * row per order on the page.
   *
   * This REPLACES the old `pcSubsForTargets`, whose `course_id IN (…) OR
   * package_id IN (…)` could not seek either column: MySQL resolved
   * (customer_id, status) from the index and then read EVERY active subscription
   * the customer owns just to test the OR — 16,773 rows to decorate 20 cards on a
   * heavy staging account. See the 2026-08-27 entry in docs/MIGRATION_QUERY_CHANGES.md.
   */
  pcSubsByOrderIds: (customerId: number, orderIds: number[]) =>
    orderIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: { customerId, status: true, orderId: { in: orderIds } },
          select: clientPurchaseHistoryRepository.PC_SUB_WINDOW_SELECT,
        })
      : Promise.resolve([]),
  /**
   * Fallback window source for LEGACY folded orders — a pre-2026-08-25 validity
   * extension folded onto the entitlement subscription and owns no row of its own,
   * so its window has to come from the latest active sub for the same target.
   *
   * Split into one query per target column ON PURPOSE. A single `OR` over
   * course_id/package_id cannot use an index on either (the optimizer picks the
   * (customer_id, status) prefix and filters row by row); two separate seeks each
   * ride their own index. Issued only for the orders that came back without a sub,
   * so on a page of SQL-native purchases neither query runs at all.
   */
  pcSubsByCourseIds: (customerId: number, courseIds: number[]) =>
    courseIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: { customerId, status: true, courseId: { in: courseIds } },
          select: clientPurchaseHistoryRepository.PC_SUB_WINDOW_SELECT,
        })
      : Promise.resolve([]),
  pcSubsByPackageIds: (customerId: number, packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: { customerId, status: true, packageId: { in: packageIds } },
          select: clientPurchaseHistoryRepository.PC_SUB_WINDOW_SELECT,
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
  /** purchased live-course sub. The AWB is `tracking`; its status is on the tracking
   *  row (ws_live_course_subscription_tracking, 2026-08-27 (c)); address is separate. */
  liveSubscriptionForTracking: (subId: number, customerId: number) =>
    prisma.liveCourseSubscription.findFirst({
      where: { id: subId, ...clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId) },
      // `bookedAt` / the order status in the tracking DTO come off the order now.
      include: {
        order: true,
        trackingRow: { select: { status: true, created_at: true, updated_at: true } },
      },
    }),
  /** delivery address for a live sub (customer_shipping_id → ws_customer_address). */
  customerAddressById: (id: number) =>
    prisma.customerAddress.findFirst({ where: { id }, select: { name: true, phone: true, city: true, address: true, pincode: true } }),

  // ── live-course receipt (single subscription, ownership-scoped) ──────────────
  /**
   * Purchased live-course sub WITH its order. The receipt is built almost entirely
   * from payment fields, which moved to the order on 2026-08-25 — `order` is included
   * so the caller can read them from there, falling back to the subscription's own
   * (legacy) columns for rows the backfill has not reached.
   */
  liveSubscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.liveCourseSubscription.findFirst({
      where: { id: subId, ...clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId) },
      include: { order: true },
    }),
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
