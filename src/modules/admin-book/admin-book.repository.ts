import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-book MySQL branch (ws_book + ws_book_order /
 * ws_book_order_item / ws_book_tracking). Books CRUD + order reads.
 *
 * ⚠ Schema-drift (ws_book has NO column for): publication, deliveryEta,
 * termsAndConditions, demoFileName/bookFileName, bookUrl, packageIds. Those
 * Mongo fields are synthesized (defaults) or dropped by the transformer.
 * (isTrending DOES exist → ws_book.is_trending, written by create/update + the
 * trending toggle; examCountdown* are stored as JSON int-arrays.)
 * NOT-NULL no-default cols (name, pages, dynamic_link) get write-time sentinels.
 */
export const adminBookRepository = {
  // ── books: list / get ──────────────────────────────────────────────────────
  list: (opts: { search?: string; language?: string; isMagazine?: boolean; isCombo?: boolean; status?: boolean; skip: number; take: number }) =>
    prisma.book.findMany({
      where: buildWhere(opts),
      orderBy: [{ order_by: "asc" }, { created_at: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  count: (opts: { search?: string; language?: string; isMagazine?: boolean; isCombo?: boolean; status?: boolean }) =>
    prisma.book.count({ where: buildWhere(opts) }),

  findById: (id: number) => prisma.book.findUnique({ where: { id } }),

  // ── books: write ────────────────────────────────────────────────────────────
  create: (data: Prisma.BookUncheckedCreateInput) => prisma.book.create({ data }),
  update: (id: number, data: Prisma.BookUncheckedUpdateInput) => prisma.book.update({ where: { id }, data }),
  delete: (id: number) => prisma.book.delete({ where: { id } }),
  setStatus: (id: number, status: boolean) =>
    prisma.book.update({ where: { id }, data: { active: status, updated_at: new Date() } }),
  setTrending: (id: number, isTrending: boolean) =>
    prisma.book.update({ where: { id }, data: { isTrending, updated_at: new Date() } }),
  setOrder: (id: number, orderBy: number) =>
    prisma.book.update({ where: { id }, data: { order_by: orderBy, updated_at: new Date() } }),

  // ── orders: list / get ──────────────────────────────────────────────────────
  /**
   * Order listing. customer/book search is resolved upstream (the service
   * collects matching customer ids + the order_ids whose item rows match a book)
   * since the relation spans ws_book_order_item.
   */
  listOrders: (opts: {
    customerId?: number;
    status?: string;
    state?: number;
    fromDate?: Date;
    toDate?: Date;
    orderIdsIn?: string[]; // VARCHAR business keys (search match on items)
    customerIdsIn?: number[]; // search match on customer
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
      orderBy: { [orderSortCol(opts.sortBy)]: opts.sortDir },
      skip: opts.skip,
      take: opts.take,
    }),
  // Keyset page for the UNBOUNDED export: same filter + includes as listOrders,
  // ordered id DESC, rows strictly older than the last id seen — no deep OFFSET, no row
  // cap, so the caller can walk the full filtered set (lakhs) in O(take) pages.
  listOrdersPageKeyset: (opts: Parameters<typeof buildOrderWhere>[0], beforeId: number | undefined, take: number) => {
    const base = buildOrderWhere(opts);
    return prisma.bookOrder.findMany({
      where: beforeId ? { AND: [base, { id: { lt: beforeId } }] } : base,
      include: {
        user: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        shipping: true,
      },
      orderBy: { id: "desc" },
      take,
    });
  },
  countOrders: (opts: { customerId?: number; status?: string; state?: number; fromDate?: Date; toDate?: Date; orderIdsIn?: string[]; customerIdsIn?: number[]; receiptSearch?: string; bookOrderKeysIn?: string[] }) =>
    prisma.bookOrder.count({ where: buildOrderWhere(opts) }),

  findOrderById: (id: number) =>
    prisma.bookOrder.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        shipping: true,
      },
    }),

  /** Line items for a set of order business keys + the linked book metadata. */
  findOrderItems: (orderKeys: string[]) =>
    orderKeys.length
      ? prisma.bookOrderItem.findMany({
          where: { order_id: { in: orderKeys } },
          include: { Book: { select: { id: true, name: true, image: true, thumbnail: true, author: true } } },
        })
      : Promise.resolve([]),

  /** Books by id (hydrate the order_items JSON snapshot's `item` book id). */
  findBooksByIds: (ids: number[]) =>
    ids.length
      ? prisma.book.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, thumbnail: true, author: true, weight: true } })
      : Promise.resolve([]),

  /** Customer ids whose name/phone matches the search (for order search). */
  findCustomerIdsBySearch: async (q: string): Promise<number[]> => {
    const rows = await prisma.customer.findMany({
      where: { OR: [{ fullName: { contains: q } }, { phoneNumber: { contains: q } }, { emailAddress: { contains: q } }] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  /**
   * Order business keys whose items match a book name. Legacy orders keep their
   * items in the `order_items` JSON column (the child table is near-empty), and
   * the Mongo path searches the embedded `items.name` — so we scan BOTH: child
   * rows (book name → bookId → item rows) AND the JSON snapshot's item `name`
   * (raw LIKE on the order_items text, mirroring the Mongo `{"items.name": rx}`).
   */
  findOrderKeysByBookSearch: async (q: string): Promise<string[]> => {
    const keys = new Set<string>();
    const books = await prisma.book.findMany({ where: { name: { contains: q } }, select: { id: true } });
    if (books.length) {
      const items = await prisma.bookOrderItem.findMany({
        where: { bookId: { in: books.map((b) => b.id) } },
        select: { order_id: true },
      });
      for (const it of items) keys.add(it.order_id);
    }
    // JSON-snapshot match: the order_items text contains the item name.
    const like = `%${q}%`;
    const rows = await prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT order_id FROM ws_book_order WHERE order_items LIKE ${like}`;
    for (const r of rows) keys.add(r.order_id);
    return [...keys];
  },

  /**
   * Order business keys that contain a specific book id. Same dual scan as the
   * name search: child rows (ws_book_order_item.bookId) AND the JSON snapshot,
   * where items serialize as `"item":<id>`. The regex anchors the id with a
   * non-digit/quote boundary so id 5 doesn't match 50/"54" etc.
   */
  findOrderKeysByBookId: async (bookId: number): Promise<string[]> => {
    const keys = new Set<string>();
    const items = await prisma.bookOrderItem.findMany({
      where: { bookId },
      select: { order_id: true },
    });
    for (const it of items) keys.add(it.order_id);
    // JSON: "item":54 or "item":"54", not followed by another digit.
    const re = `"item":"?${bookId}"?([^0-9]|$)`;
    const rows = await prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT order_id FROM ws_book_order WHERE order_items REGEXP ${re}`;
    for (const r of rows) keys.add(r.order_id);
    return [...keys];
  },
};

function buildWhere(opts: { search?: string; language?: string; isMagazine?: boolean; isCombo?: boolean; status?: boolean }): Prisma.BookWhereInput {
  const where: Prisma.BookWhereInput = {};
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [{ name: { contains: q } }, { author: { contains: q } }];
  }
  if (opts.language) where.language = opts.language;
  if (opts.isMagazine !== undefined) where.is_magazine = opts.isMagazine;
  if (opts.isCombo !== undefined) where.isCombo = opts.isCombo;
  if (opts.status !== undefined) where.active = opts.status;
  return where;
}

function orderSortCol(sortBy: string): string {
  if (sortBy === "amount" || sortBy === "order_price") return "amount";
  if (sortBy === "status") return "status";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updatedAt";
  return "createdAt";
}

function buildOrderWhere(opts: { customerId?: number; status?: string; state?: number; fromDate?: Date; toDate?: Date; orderIdsIn?: string[]; customerIdsIn?: number[]; receiptSearch?: string; bookOrderKeysIn?: string[] }): Prisma.BookOrderWhereInput {
  const where: Prisma.BookOrderWhereInput = {};
  if (opts.customerId !== undefined) where.userId = opts.customerId;
  if (opts.status) where.status = opts.status;
  // Delivery-state filter lives on the linked shipping row (numeric state id).
  if (opts.state !== undefined) where.shipping = { is: { state: opts.state } };
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  // bookId filter: AND restriction to orders that contain the book (by business
  // key). Empty array → matches nothing (no order has that book).
  if (opts.bookOrderKeysIn) where.receiptId = { in: opts.bookOrderKeysIn };
  // Search OR: receiptId match | order belongs to a matched customer | order_id
  // appears in the item-matched key set. Each clause optional; AND with filters.
  const or: Prisma.BookOrderWhereInput[] = [];
  if (opts.receiptSearch) or.push({ receiptId: { contains: opts.receiptSearch } });
  if (opts.customerIdsIn?.length) or.push({ userId: { in: opts.customerIdsIn } });
  if (opts.orderIdsIn?.length) or.push({ receiptId: { in: opts.orderIdsIn } });
  if (or.length) where.OR = or;
  return where;
}
