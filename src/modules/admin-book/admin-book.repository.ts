// Admin books: Prisma queries for books and book orders.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildPrismaPrefixSearch, buildPrismaSearch, searchNumericId } from "../../utils/searchFilter";

/**
 * ws_book has no column for publication, deliveryEta, termsAndConditions,
 * demoFileName/bookFileName, bookUrl or packageIds; the transformer synthesizes or
 * drops them. examCountdown* are JSON int-arrays. NOT NULL no-default cols (name,
 * pages, dynamic_link) get write-time sentinels.
 */
export const adminBookRepository = {
  list: (opts: { search?: string; language?: string; isMagazine?: boolean; isCombo?: boolean; status?: boolean; skip: number; take: number; orderBy?: Prisma.BookOrderByWithRelationInput[] }) =>
    prisma.book.findMany({
      where: buildWhere(opts),
      // Default is recency; `orderBy` overrides it for an explicit sortBy.
      orderBy: opts.orderBy ?? [{ created_at: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  count: (opts: { search?: string; language?: string; isMagazine?: boolean; isCombo?: boolean; status?: boolean }) =>
    prisma.book.count({ where: buildWhere(opts) }),

  findById: (id: number) => prisma.book.findUnique({ where: { id } }),

  create: (data: Prisma.BookUncheckedCreateInput) => prisma.book.create({ data }),
  update: (id: number, data: Prisma.BookUncheckedUpdateInput) => prisma.book.update({ where: { id }, data }),
  delete: (id: number) => prisma.book.delete({ where: { id } }),
  setStatus: (id: number, status: boolean) =>
    prisma.book.update({ where: { id }, data: { active: status, updated_at: new Date() } }),
  setTrending: (id: number, isTrending: boolean) =>
    prisma.book.update({ where: { id }, data: { isTrending, updated_at: new Date() } }),
  setOrder: (id: number, orderBy: number) =>
    prisma.book.update({ where: { id }, data: { order_by: orderBy, updated_at: new Date() } }),

  /**
   * Customer/book search is resolved upstream (customer ids + order_ids whose item rows
   * match a book) since the relation spans ws_book_order_item.
   */
  listOrders: (opts: {
    customerId?: number;
    status?: string;
    state?: number;
    fromDate?: Date;
    toDate?: Date;
    orderIdsIn?: string[]; // VARCHAR business keys (search match on items)
    receiptSearch?: string;
    bookOrderKeysIn?: string[]; // AND restriction: orders containing a given book
    sortBy: string;
    sortDir: "asc" | "desc";
    skip: number;
    take: number;
  }) =>
    prisma.bookOrder.findMany({
      where: buildOrderWhere(opts),
      include: {
        user: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        shipping: true,
      },
      orderBy: [{ [orderSortCol(opts.sortBy)]: opts.sortDir }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  // Keyset page for the unbounded export: same filter + includes as listOrders, ordered
  // tracking_id ASC then the untracked (NULL) tail by id ASC, walked separately since NULL
  // can't be compared. tracking_id isn't unique (admin can set it), hence the (tracking_id, id) key.
  listOrdersPageKeyset: (opts: Parameters<typeof buildOrderWhere>[0], cursor: OrderExportCursor, take: number) => {
    const base = buildOrderWhere(opts);
    const page: Prisma.BookOrderWhereInput = cursor.untracked
      ? { trackingId: null, ...(cursor.afterId ? { id: { gt: cursor.afterId } } : {}) }
      : cursor.afterTracking != null
        ? { OR: [{ trackingId: { gt: cursor.afterTracking } }, { trackingId: cursor.afterTracking, id: { gt: cursor.afterId } }] }
        : { trackingId: { not: null } };
    return prisma.bookOrder.findMany({
      where: { AND: [base, page] },
      include: {
        user: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        shipping: true,
      },
      orderBy: cursor.untracked ? { id: "asc" } : [{ trackingId: "asc" }, { id: "asc" }],
      take,
    });
  },
  countOrders: (opts: { customerId?: number; status?: string; state?: number; fromDate?: Date; toDate?: Date; orderIdsIn?: string[]; receiptSearch?: string; bookOrderKeysIn?: string[] }) =>
    prisma.bookOrder.count({ where: buildOrderWhere(opts) }),

  findOrderById: (id: number) =>
    prisma.bookOrder.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        shipping: true,
      },
    }),

  findOrderItems: (orderKeys: string[]) =>
    orderKeys.length
      ? prisma.bookOrderItem.findMany({
          where: { order_id: { in: orderKeys } },
          include: { Book: { select: { id: true, name: true, image: true, thumbnail: true, author: true } } },
        })
      : Promise.resolve([]),

  findBooksByIds: (ids: number[]) =>
    ids.length
      ? prisma.book.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, thumbnail: true, author: true, weight: true } })
      : Promise.resolve([]),

  /**
   * Order keys whose child item rows match a book name. The JSON snapshot and customer
   * match are applied in-query by buildOrderWhere, never materialized as id lists: a
   * 1-char search over ws_customer (1M+ rows) blew MySQL's 65,535-placeholder cap (ER 1390).
   */
  findOrderKeysByBookSearch: async (q: string): Promise<string[]> => {
    const books = await prisma.book.findMany({ where: buildPrismaPrefixSearch(q, ["name"]) ?? {}, select: { id: true } });
    if (!books.length) return [];
    const items = await prisma.bookOrderItem.findMany({
      where: { bookId: { in: books.map((b) => b.id) } },
      select: { order_id: true },
      distinct: ["order_id"],
    });
    return items.map((it) => it.order_id);
  },

  /**
   * Order keys containing a book id: child rows AND the JSON snapshot (`"item":<id>`).
   * The regex anchors the id with a non-digit/quote boundary so 5 doesn't match 50/"54".
   */
  findOrderKeysByBookId: async (bookId: number): Promise<string[]> => {
    const keys = new Set<string>();
    const items = await prisma.bookOrderItem.findMany({
      where: { bookId },
      select: { order_id: true },
    });
    for (const it of items) keys.add(it.order_id);
    const re = `"item":"?${bookId}"?([^0-9]|$)`;
    const rows = await prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT order_id FROM ws_book_order WHERE order_items REGEXP ${re}`;
    for (const r of rows) keys.add(r.order_id);
    return [...keys];
  },
};

function buildWhere(opts: { search?: string; language?: string; isMagazine?: boolean; isCombo?: boolean; status?: boolean }): Prisma.BookWhereInput {
  const where: Prisma.BookWhereInput = {};
  const search = buildPrismaPrefixSearch(opts.search, ["name", "author"]);
  if (search) Object.assign(where, search);
  if (opts.language) where.language = opts.language;
  if (opts.isMagazine !== undefined) where.is_magazine = opts.isMagazine;
  if (opts.isCombo !== undefined) where.isCombo = opts.isCombo;
  if (opts.status !== undefined) where.active = opts.status;
  return where;
}

export type OrderExportCursor = { untracked: boolean; afterTracking?: bigint; afterId?: number };

function orderSortCol(sortBy: string): string {
  if (sortBy === "amount" || sortBy === "order_price") return "amount";
  if (sortBy === "status") return "status";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updatedAt";
  if (sortBy === "trackingId" || sortBy === "tracking_id") return "trackingId";
  return "createdAt";
}

function buildOrderWhere(opts: { customerId?: number; status?: string; state?: number; fromDate?: Date; toDate?: Date; orderIdsIn?: string[]; receiptSearch?: string; bookOrderKeysIn?: string[] }): Prisma.BookOrderWhereInput {
  const where: Prisma.BookOrderWhereInput = {};
  if (opts.customerId !== undefined) where.userId = opts.customerId;
  if (opts.status) where.status = opts.status;
  // Delivery-state filter lives on the linked shipping row.
  if (opts.state !== undefined) where.shipping = { is: { state: opts.state } };
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  // Empty array → matches nothing.
  if (opts.bookOrderKeysIn) where.receiptId = { in: opts.bookOrderKeysIn };
  // Search OR: receiptId | matching customer | items JSON | child-item-matched keys.
  const or: Prisma.BookOrderWhereInput[] = [];
  // Receipt key or Razorpay order/payment id (prefix LIKE).
  const receiptSearch = buildPrismaPrefixSearch(opts.receiptSearch, ["receiptId", "gatewayOrderId", "gatewayPaymentId"]);
  if (receiptSearch) or.push(receiptSearch);
  // All-digit term: exact customer id / tracking AWB (BIGINT, LIKE can't serve it).
  const numericId = searchNumericId(opts.receiptSearch);
  if (numericId) {
    or.push({ trackingId: numericId.big });
    if (numericId.int !== undefined) or.push({ userId: numericId.int });
  }
  // Customer and JSON-snapshot item matches resolve as SQL, not bound id lists
  // (see findOrderKeysByBookSearch).
  const customerSearch = buildPrismaPrefixSearch(opts.receiptSearch, ["fullName", "phoneNumber", "emailAddress"]);
  if (customerSearch) or.push({ user: { is: customerSearch } });
  const itemsSearch = buildPrismaSearch(opts.receiptSearch, ["orderItems"]);
  if (itemsSearch) or.push(itemsSearch);
  if (opts.orderIdsIn?.length) or.push({ receiptId: { in: opts.orderIdsIn } });
  if (or.length) where.OR = or;
  return where;
}
