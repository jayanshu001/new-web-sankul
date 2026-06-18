import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the client orders MySQL branch (Wave 7).
 * Read-aggregation over already-migrated tables; no new tables. Backs
 * `listMyOrders` — all of a customer's course/package subs + ebook subs + book
 * orders (unfiltered, newest-first). The order WRITES (placeCourseOrder /
 * placeEbookOrder / verifyPayment) stay Mongo → payment wave.
 *
 * ⚠ Same drift family as client-purchase-history: SQL package_id = the package
 * (pcb_id = the plan/price); ws_ebook_order has no ebook_id (plan→ebook hop);
 * book items live in the order_items JSON.
 */
export const clientOrdersRepository = {
  listCourseSubs: (customerId: number) =>
    prisma.packageCourseSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),

  listEbookSubs: (customerId: number) =>
    prisma.eBookSubscription.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } }),

  listBookOrders: (customerId: number) =>
    prisma.bookOrder.findMany({ where: { userId: customerId }, orderBy: { createdAt: "desc" } }),

  // hydration
  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true, author: true } }) : Promise.resolve([]),
};
