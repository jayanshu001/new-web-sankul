// Purchase history: Prisma queries (raw SQL binds customer_id as a string).
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * `customer_id` on ws_package_course_order and ws_ebook_order is VARCHAR in the DB, but
 * schema.prisma declares it `Int?`, so Prisma binds an INT. MySQL then numeric-casts every row,
 * which defeats every index led by customer_id (prod: 2973ms / 424,801 rows vs 0.03ms / 6 rows
 * with a string bind). The raw queries below exist SOLELY to bind `String(customerId)`. The
 * real fix is `ALTER TABLE ... MODIFY customer_id INT` on both tables (see
 * docs/MIGRATION_QUERY_CHANGES.md, 2026-09-18).
 */
type PurchaseOrderRow = {
  id: number;
  planId: number | null;
  createdAt: Date | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  amount: number | null;
};
type EbookOrderRow = {
  id: number;
  planId: number | null;
  orderPrice: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  status: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  bankTransactionId: string | null;
};

/**
 *  - ws_package_course_subscription has no payment_status; status=true is "verified".
 *  - package_id = the package; pcb_id = the plan.
 *  - ws_ebook_order has no ebook_id: resolve via plan_id → price → ebook.
 *  - ws_book_order items live in the order_items JSON; the courier is not stored.
 */
export const clientPurchaseHistoryRepository = {
  // Live-course subs live outside ws_package_course_subscription, so they are unioned in.
  // Keyed on the SUBSCRIPTION (unlike package/course and test-series) because the emitted
  // `lc_`-prefixed `_id` is the subscription id the receipt/tracking resolvers look up;
  // subscription rows are 1:1 with orders. "Purchased" is the ORDER's status; a row with no
  // order is not a purchase.
  liveSubscriptionPurchasedWhere: (customerId: number) => ({
    customerId,
    order: { status: "complete" },
  }),
  // `order` carries `amount` + the razorpay ids.
  listLiveSubscriptions: (customerId: number, take: number) =>
    prisma.liveCourseSubscription.findMany({
      where: clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId),
      orderBy: { id: "desc" },
      take,
      // Dispatch status lives on ws_live_course_subscription_tracking.
      include: { order: true, trackingRow: { select: { status: true } } },
    }),
  countLiveSubscriptions: (customerId: number) =>
    prisma.liveCourseSubscription.count({ where: clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId) }),
  liveCoursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),

  testSeriesByIds: (ids: number[]) =>
    ids.length ? prisma.testSeries.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, thumbnail: true } }) : Promise.resolve([]),

  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, packageTypeId: true } }) : Promise.resolve([]),
  packageTypesByIds: (ids: number[]) =>
    ids.length ? prisma.packageType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),

  // Purchase History shows every purchase, so package/course + test-series list from their
  // ORDER tables (each completed order = one row).
  listPurchaseOrders: (customerId: number, skip: number, take: number) =>
    prisma.$queryRawUnsafe<PurchaseOrderRow[]>(
      `SELECT id, plan_id AS planId, created_at AS createdAt, razorpay_order_id AS gatewayOrderId,
              razorpay_payment_id AS gatewayPaymentId, discount_price AS amount
       FROM ws_package_course_order
       WHERE customer_id = ? AND status = 'complete'
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      String(customerId), take, skip
    ),
  countPurchaseOrders: (customerId: number) =>
    prisma
      .$queryRawUnsafe<{ n: bigint | number }[]>(
        `SELECT COUNT(*) AS n FROM ws_package_course_order WHERE customer_id = ? AND status = 'complete'`,
        String(customerId)
      )
      .then((r) => Number(r[0]?.n ?? 0)),
  pcPlansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, courseId: true, packageId: true, withMaterial: true, duration: true } }) : Promise.resolve([]),
  /** Keyed by the ORDER that created them (material orders only). */
  pcTrackingByOrderIds: (orderIds: number[]) =>
    orderIds.length ? prisma.packageCourseSubscriptionTracking.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, orderId: true, status: true, updated_at: true, created_at: true } }) : Promise.resolve([]),
  PC_SUB_WINDOW_SELECT: { id: true, orderId: true, courseId: true, packageId: true, startAt: true, endAt: true } as const,
  /**
   * Validity window for the page's own orders (one order = one subscription row).
   * `order_id IN (…)` rides idx_pcs_customer_status_order, reading at most one row per order.
   * Do not reintroduce a `course_id IN OR package_id IN` lookup: it can seek neither column
   * and scans every active sub the customer owns.
   */
  pcSubsByOrderIds: (customerId: number, orderIds: number[]) =>
    orderIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: { customerId, status: true, orderId: { in: orderIds } },
          select: clientPurchaseHistoryRepository.PC_SUB_WINDOW_SELECT,
        })
      : Promise.resolve([]),
  /**
   * Fallback window for legacy folded orders (an extension that owns no subscription row),
   * taken from the latest active sub for the same target. One query per target column on
   * purpose: an `OR` over course_id/package_id can use neither index. Only issued for orders
   * that came back without a sub.
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

  // Legacy purchases exist as subscriptions with no order row; they are unioned back in under a
  // distinct id prefix so receipt/tracking route to the sub-based path. Native purchases and
  // manual grants always have a complete order, so nothing is double-counted.
  listOrderlessSubs: (customerId: number, skip: number, take: number) =>
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, orderId: null },
      include: { packageCourseSubscriptionTracking: { select: { status: true } } },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countOrderlessSubs: (customerId: number) =>
    prisma.packageCourseSubscription.count({ where: { customerId, status: true, orderId: null } }),

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

  // Book names live inside the order_items JSON text, so a LIKE over it matches by title.
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

  // ws_ebook_order has no ebook_id or title, so name search arrives as `planIds`.
  listEbookOrders: (customerId: number, status: string, skip: number, take: number, planIds?: number[]) => {
    const planFilter = planIds?.length ? ` AND plan_id IN (${planIds.map(() => "?").join(",")})` : "";
    return prisma.$queryRawUnsafe<EbookOrderRow[]>(
      `SELECT id, plan_id AS planId, order_price AS orderPrice, created_at AS createdAt, updated_at AS updatedAt,
              status, razorpay_order_id AS gatewayOrderId, razorpay_payment_id AS gatewayPaymentId,
              transaction_id AS bankTransactionId
       FROM ws_ebook_order
       WHERE customer_id = ? AND status = ?${planFilter}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      String(customerId), status, ...(planIds ?? []), take, skip
    );
  },
  countEbookOrders: (customerId: number, status: string, planIds?: number[]) => {
    const planFilter = planIds?.length ? ` AND plan_id IN (${planIds.map(() => "?").join(",")})` : "";
    return prisma
      .$queryRawUnsafe<{ n: bigint | number }[]>(
        `SELECT COUNT(*) AS n FROM ws_ebook_order WHERE customer_id = ? AND status = ?${planFilter}`,
        String(customerId), status, ...(planIds ?? [])
      )
      .then((r) => Number(r[0]?.n ?? 0));
  },
  ebookIdsByName: (search: string) =>
    prisma.eBook.findMany({ where: buildPrismaSearch(search, ["name"]) ?? {}, select: { id: true } }),
  planIdsByEbookIds: (ebookIds: number[]) =>
    ebookIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ebookIds } }, select: { id: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, ebookId: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, author: true } }) : Promise.resolve([]),
  /** start_at is the purchase-date proxy for legacy orders with NULL created_at; ebook_id
   *  resolves plan-less orders (manual grants). */
  ebookSubStartByOrderIds: (orderIds: number[]) =>
    orderIds.length ? prisma.eBookSubscription.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, startAt: true, endAt: true, ebookId: true } }) : Promise.resolve([]),

  ebookOrderForReceipt: (orderId: number, customerId: number) =>
    prisma.eBookOrder.findFirst({ where: { id: orderId, userId: customerId } }),
  planForReceipt: (planId: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id: planId }, select: { id: true, ebookId: true, duration: true } }),
  ebookById: (id: number) =>
    prisma.eBook.findFirst({ where: { id }, select: { id: true, name: true, author: true } }),
  /** For plan-less orders (manual grants). */
  ebookIdBySubForOrder: (orderId: number) =>
    prisma.eBookSubscription.findFirst({ where: { orderId }, select: { ebookId: true } }),

  bookOrderForReceipt: (orderId: number, customerId: number) =>
    prisma.bookOrder.findFirst({
      where: { id: orderId, userId: customerId },
      include: { BookTracking: { select: { tracking_id: true, status: true } } },
    }),

  // Keyed by the ORDER id (the purchase-history _id). The address may instead live in
  // ws_customer_address (customerAddressById); the service falls back.
  courseOrderByIdForReceipt: (orderId: number, customerId: number) =>
    prisma.packageCourseOrder.findFirst({
      where: { id: orderId, userId: customerId },
      include: { CustomerShipping: { select: { name: true, phone: true, city: true, address: true, pincode: true } } },
    }),

  subscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.packageCourseSubscription.findFirst({ where: { id: subId, customerId, status: true } }),
  planDurationForReceipt: (planId: number) =>
    prisma.packageCourseEbookPrice.findFirst({ where: { id: planId }, select: { id: true, duration: true } }),
  courseForReceipt: (id: number) =>
    prisma.course.findFirst({ where: { id }, select: { id: true, name: true } }),
  packageForReceipt: (id: number) =>
    prisma.package.findFirst({ where: { id }, select: { id: true, name: true } }),

  subscriptionForTracking: (subId: number, customerId: number) =>
    prisma.packageCourseSubscription.findFirst({
      where: { id: subId, customerId, status: true },
      include: {
        customerShipping: { select: { name: true, phone: true, city: true, address: true, pincode: true } },
        packageCourseSubscriptionTracking: { select: { status: true, created_at: true, updated_at: true } },
      },
    }),
  /** The AWB is `tracking`; its status is on the tracking row; the address is separate. */
  liveSubscriptionForTracking: (subId: number, customerId: number) =>
    prisma.liveCourseSubscription.findFirst({
      where: { id: subId, ...clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId) },
      // `bookedAt` / the order status in the tracking DTO come off the order.
      include: {
        order: true,
        trackingRow: { select: { status: true, created_at: true, updated_at: true } },
      },
    }),
  /** customer_shipping_id → ws_customer_address. */
  customerAddressById: (id: number) =>
    prisma.customerAddress.findFirst({ where: { id }, select: { name: true, phone: true, city: true, address: true, pincode: true } }),

  /** The receipt is built from payment fields, which live on the order. */
  liveSubscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.liveCourseSubscription.findFirst({
      where: { id: subId, ...clientPurchaseHistoryRepository.liveSubscriptionPurchasedWhere(customerId) },
      include: { order: true },
    }),
  liveCourseForReceipt: (id: number) =>
    prisma.liveCourse.findFirst({ where: { id }, select: { id: true, name: true } }),
  /** duration is DAYS. */
  livePlanForReceipt: (planId: number) =>
    prisma.liveCoursePlan.findFirst({ where: { id: planId }, select: { id: true, duration: true } }),

  testSeriesSubscriptionForReceipt: (subId: number, customerId: number) =>
    prisma.testSeriesSubscription.findFirst({ where: { id: subId, customerId, status: true } }),
  testSeriesOrderByIdForReceipt: (orderId: number, customerId: number) =>
    prisma.testSeriesOrder.findFirst({ where: { id: orderId, customerId } }),
  testSeriesForReceipt: (id: number) =>
    prisma.testSeries.findFirst({ where: { id }, select: { id: true, title: true } }),
  testSeriesPlanForReceipt: (planId: number) =>
    prisma.testSeriesPrice.findFirst({ where: { id: planId }, select: { id: true, durationDays: true } }),
};
