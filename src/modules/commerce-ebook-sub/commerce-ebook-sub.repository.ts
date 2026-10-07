// Ebook subscriptions: Prisma queries.
import { prisma } from "../../config/prisma";

export const commerceEbookSubRepository = {
  findById: (id: number) =>
    prisma.eBookSubscription.findUnique({ where: { id } }),

  findByOrderId: (orderId: number) =>
    prisma.eBookSubscription.findFirst({ where: { orderId } }),

  /**
   * The ebook access gate (latest endAt wins). `status: {not: false}` treats the nullable
   * column's NULL as active, consistent with the transformer's NULL→true coercion.
   */
  findActiveSub: (customerId: number, ebookId: number, now: Date) =>
    prisma.eBookSubscription.findFirst({
      where: { customerId, ebookId, status: { not: false }, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  listByCustomer: (customerId: number) =>
    prisma.eBookSubscription.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

  listActiveByCustomer: (customerId: number, now: Date) =>
    prisma.eBookSubscription.findMany({
      where: { customerId, status: { not: false }, endAt: { gt: now } },
      orderBy: [{ endAt: "desc" }, { id: "desc" }],
    }),

  /** The "my subscriptions" listing, soonest-to-expire first; optionally scoped to ebook ids (search). */
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

  /** Must keep the same predicate as listActiveWithEbookByCustomer. */
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

  countActiveByEbook: (ebookId: number, now: Date) =>
    prisma.eBookSubscription.count({
      where: { ebookId, status: { not: false }, endAt: { gt: now } },
    }),

  /** Per-ebook access windows for a listing. Strict `status:true` to match the listing predicate. */
  listActiveByCustomerForEbooks: (customerId: number, ebookIds: number[], now: Date) =>
    ebookIds.length
      ? prisma.eBookSubscription.findMany({
          where: { customerId, ebookId: { in: ebookIds }, status: true, endAt: { gt: now } },
          select: { ebookId: true, endAt: true },
        })
      : Promise.resolve([]),
};
