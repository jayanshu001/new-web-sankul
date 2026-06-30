import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the commerce · ebook-subscription READ branch
 * (`ws_ebook_subscription`, Phase 3a — READ-ONLY, flag OFF).
 *
 * The ebook entitlement source of truth. Read predicates mirror the Mongo
 * consumers exactly:
 *  - active entitlement: `{customerId, ebookId, status:true, endAt:{$gt:now}}`
 *    sorted by `endAt` desc (latest window wins) — the ebook access/read gate
 *  - a customer's active ebook ids (the "downloads" surface)
 *  - by order id (receipt/order linkage)
 *
 * NO writes — ebook subscription create is Phase 3b.
 */
export const commerceEbookSubRepository = {
  /** Single ebook subscription by id. */
  findById: (id: number) =>
    prisma.eBookSubscription.findUnique({ where: { id } }),

  /** Single ebook subscription by its order id. */
  findByOrderId: (orderId: number) =>
    prisma.eBookSubscription.findFirst({ where: { orderId } }),

  /**
   * Active, unexpired ebook entitlement for a customer (latest endAt wins).
   * Mirrors `findOne({customerId, ebookId, status:true, endAt:{$gt:now}})`.
   * `status: {not: false}` treats the nullable column's NULL as active
   * (default 1), consistent with the transformer's NULL→true coercion.
   */
  findActiveSub: (customerId: number, ebookId: number, now: Date) =>
    prisma.eBookSubscription.findFirst({
      where: { customerId, ebookId, status: { not: false }, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  /** All ebook subscriptions for a customer, newest first. */
  listByCustomer: (customerId: number) =>
    prisma.eBookSubscription.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

  /** Active (status + unexpired) ebook subscriptions for a customer. */
  listActiveByCustomer: (customerId: number, now: Date) =>
    prisma.eBookSubscription.findMany({
      where: { customerId, status: { not: false }, endAt: { gt: now } },
      orderBy: [{ endAt: "desc" }, { id: "desc" }],
    }),

  /**
   * Active, unexpired ebook subs for a customer with the joined ebook row,
   * paginated, `endAt` ASC (soonest-to-expire first) — the "my subscriptions"
   * listing. Optionally scoped to a set of ebook ids (search-by-ebook).
   * Mirrors `find({customerId, endAt:{$gt:now}, status:true [, ebookId:{$in}]})
   * .populate('ebookId').sort({endAt:1}).skip().limit()`.
   */
  listActiveWithEbookByCustomer: (
    customerId: number,
    opts: { ebookIds?: number[]; skip: number; take: number },
    now: Date
  ) =>
    prisma.eBookSubscription.findMany({
      where: {
        customerId,
        status: { not: false },
        endAt: { gt: now },
        ...(opts.ebookIds ? { ebookId: { in: opts.ebookIds } } : {}),
      },
      include: { eBook: true },
      orderBy: [{ endAt: "asc" }, { id: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  /** Count of the active-with-ebook listing above (same predicate). */
  countActiveWithEbookByCustomer: (
    customerId: number,
    opts: { ebookIds?: number[] },
    now: Date
  ) =>
    prisma.eBookSubscription.count({
      where: {
        customerId,
        status: { not: false },
        endAt: { gt: now },
        ...(opts.ebookIds ? { ebookId: { in: opts.ebookIds } } : {}),
      },
    }),

  /** Count active owners of an ebook. */
  countActiveByEbook: (ebookId: number, now: Date) =>
    prisma.eBookSubscription.count({
      where: { ebookId, status: { not: false }, endAt: { gt: now } },
    }),

  /**
   * Active, unexpired ebook subs for a customer scoped to a set of ebook ids.
   * Mirrors the ebook-listing query `{customerId, ebookId:{$in}, status:true,
   * endAt:{$gt:now}}`. Returns only `{ebookId, endAt}` (enough for the per-ebook
   * access window). Uses strict `status:true` to match the listing predicate.
   */
  listActiveByCustomerForEbooks: (customerId: number, ebookIds: number[], now: Date) =>
    ebookIds.length
      ? prisma.eBookSubscription.findMany({
          where: { customerId, ebookId: { in: ebookIds }, status: true, endAt: { gt: now } },
          select: { ebookId: true, endAt: true },
        })
      : Promise.resolve([]),
};
