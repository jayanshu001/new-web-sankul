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

  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, packageTypeId: true } }) : Promise.resolve([]),
  packageTypesByIds: (ids: number[]) =>
    ids.length ? prisma.packageType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),

  // ── books tab ──────────────────────────────────────────────────────────────
  listBookOrders: (customerId: number, statuses: string[], skip: number, take: number) =>
    prisma.bookOrder.findMany({
      where: { userId: customerId, status: { in: statuses } },
      include: { BookTracking: { select: { tracking_id: true, status: true } } },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countBookOrders: (customerId: number, statuses: string[]) =>
    prisma.bookOrder.count({ where: { userId: customerId, status: { in: statuses } } }),
  booksByIds: (ids: number[]) =>
    ids.length ? prisma.book.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, image: true } }) : Promise.resolve([]),

  // ── ebooks tab ───────────────────────────────────────────────────────────────
  listEbookOrders: (customerId: number, status: string, skip: number, take: number) =>
    prisma.eBookOrder.findMany({
      where: { userId: customerId, status: status as any },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countEbookOrders: (customerId: number, status: string) =>
    prisma.eBookOrder.count({ where: { userId: customerId, status: status as any } }),
  /** ebook order → plan → ebook (ws_ebook_order has no ebook_id). */
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, ebookId: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, author: true } }) : Promise.resolve([]),

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
};
