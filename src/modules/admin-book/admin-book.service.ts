import ExcelJS from "exceljs";
import { nextOrder } from "../../utils/listOrdering";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import type { ReportSource } from "../../utils/reportStream";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminBookRepository as repo } from "./admin-book.repository";
import { parseIdArray, populateExamCountdowns } from "../exam-countdown/exam-countdown.service";
import type { Book } from "@prisma/client";

export const ADMIN_BOOK_MODULE = "admin-book";
export const isAdminBookMysql = (): boolean => true;

export const parseBookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Parse a date-range bound. A bare "YYYY-MM-DD" is pinned to the IST day edge
// (from → 00:00:00.000, to → 23:59:59.999 at Asia/Kolkata, +05:30) so the admin's
// calendar-date pick includes the full IST day (a naive UTC parse drops the last
// 5.5h); full timestamps pass through unchanged. Invalid input → undefined.
const parseDayBound = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`)
    : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// The Mongo defaults for the SQL-absent publication / deliveryEta fields
// (mirror catalog-book.transformer).
const DEFAULT_PUBLICATION = "WebSankul Publication";
const DEFAULT_DELIVERY_ETA = "5-7 days";

/**
 * `ws_book` row → admin Book DTO, shape-compatible with the Mongo `Book`
 * document. isTrending is read from ws_book.is_trending (settable on
 * create/update + the trending toggle). Other SQL-absent fields are synthesized:
 * publication/deliveryEta defaults, demoFileName/bookFileName=null, bookUrl=null
 * (only demo_url exists), and packageIds = [] (no SQL column/table).
 * termsAndConditions is NO LONGER synthesized — it persists to
 * ws_book.terms_and_conditions (added 2026-08-18), the same way the ebook stores it.
 *
 * examCountdownIds / examCountdownCategoryIds are stored as JSON int-arrays on
 * ws_book (C6). This base DTO returns the raw ID ARRAYS — the columns are already
 * on the row (`repo.list` uses no `select`), so emitting them costs no extra
 * query. The single-book detail (`getBook`) overlays the Mongo `.populate()`
 * shape (ids → {_id, name, …}) via `populateExamCountdowns` on top of these.
 */
// ws_book.thumbnail is NOT NULL, so create stores a " " (space) sentinel when no
// thumbnail is given. Normalise blank/whitespace back to null on read so the API
// signals "no thumbnail" correctly instead of leaking the sentinel.
const blankToNull = (v: string | null | undefined): string | null =>
  v != null && v.trim() !== "" ? v : null;

export const toBookDto = (row: Book) => {
  // Ids go out as strings to match the populated shape's `_id` (and every other
  // id this API emits) — the admin drops non-string ids when normalising.
  const countdownCategoryIds = parseIdArray(row.examCountdownCategoryIds).map(String);
  const countdownIds = parseIdArray(row.examCountdownIds).map(String);
  return {
    _id: String(row.id),
    name: row.name,
    // Legacy single field mirrors the first category, same rule as `getBook`.
    examCountdownCategoryId: countdownCategoryIds[0] ?? null,
    examCountdownCategoryIds: countdownCategoryIds,
    examCountdownIds: countdownIds,
    packageIds: [],
    thumbnail: blankToNull(row.thumbnail),
    author: row.author ?? null,
    image: row.image ?? null,
    description: row.description ?? null,
    termsAndConditions: row.termsAndConditions ?? null,
    demoUrl: row.demo_url ?? null,
    bookUrl: null,
    // Original demo-PDF upload name (books have no full-book PDF, so bookFileName
    // stays null). Columns: demo_file_name.
    demoFileName: blankToNull(row.demoFileName),
    bookFileName: null,
    weight: row.weight ?? 0,
    pages: row.pages ?? 0,
    dynamicLink: row.dynamic_link ?? null,
    listPrice: row.list_price,
    discountedPrice: row.discounted_price,
    shippingPrice: row.shipping_price,
    orderBy: row.order_by ?? 0,
    language: row.language,
    isMagazine: row.is_magazine,
    isCombo: row.isCombo,
    publication: DEFAULT_PUBLICATION,
    deliveryEta: DEFAULT_DELIVERY_ETA,
    isTrending: row.isTrending,
    status: row.active,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
};

// ── customer / shipping / item DTOs (order surfaces) ───────────────────────────
const toCustomerDto = (c: { id: number; fullName: string | null; phoneNumber: string; emailAddress?: string | null } | null) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber, emailAddress: c.emailAddress ?? null };
};

const toShippingDto = (s: any | null) => {
  if (!s) return null;
  return {
    _id: String(s.id),
    name: s.name,
    phone: s.phone != null ? String(s.phone) : null,
    alternatePhone: s.alternate_phone != null ? String(s.alternate_phone) : null,
    email: s.email,
    address: s.address,
    address2: s.address_2,
    city: s.city,
    state: s.state ?? null,
    pincode: s.pincode,
  };
};

// ── books: list / get ──────────────────────────────────────────────────────────
/**
 * Sortable columns exposed as `?sortBy=`. Anything else (or nothing) falls back
 * to recency — `created_at DESC, id DESC`. `orderBy` is listed for the reorder
 * UI's benefit but is intercepted in listBooks; see utils/listOrdering.
 */
const BOOK_SORT_COLUMNS: Record<string, keyof Prisma.BookOrderByWithRelationInput> = {
  name: "name",
  createdAt: "created_at",
  updatedAt: "updated_at",
  orderBy: "order_by",
  listPrice: "list_price",
  discountedPrice: "discounted_price",
};

export const listBooks = async (q: {
  search?: string;
  language?: string;
  isMagazine?: boolean;
  isCombo?: boolean;
  status?: boolean;
  sortBy?: string;
  sortOrder?: string;
  page: number;
  limit: number;
}) => {
  const opts = { search: q.search, language: q.language, isMagazine: q.isMagazine, isCombo: q.isCombo, status: q.status };
  // `sortBy=orderBy` means "the default list view" — recency wins there, so it is
  // NOT forwarded as a column. See utils/listOrdering (RECENCY IS THE CONTRACT).
  const column = q.sortBy && q.sortBy !== "orderBy" ? BOOK_SORT_COLUMNS[q.sortBy] : undefined;
  const direction: Prisma.SortOrder = q.sortOrder === "asc" ? "asc" : "desc";
  // `id` breaks ties so paging stays stable when the sort column repeats.
  const orderBy = column ? [{ [column]: direction }, { id: direction }] as Prisma.BookOrderByWithRelationInput[] : undefined;
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit, orderBy }),
    repo.count(opts),
  ]);
  return { data: rows.map(toBookDto), total };
};

export const getBook = async (id: number) => {
  const row = await repo.findById(id);
  if (!row) return null;
  // C6: resolve the stored JSON int-arrays to the Mongo `.populate()` shapes.
  const ec = await populateExamCountdowns(row);
  return {
    ...toBookDto(row),
    examCountdownIds: ec.examCountdownIds,
    examCountdownCategoryIds: ec.examCountdownCategoryIds,
    examCountdownCategoryId: ec.examCountdownCategoryIds[0] ?? null,
  };
};

// ── books: write ────────────────────────────────────────────────────────────────
export interface BookWriteInput {
  name?: string;
  thumbnail?: string;
  author?: string;
  image?: string;
  description?: string;
  // Per-book T&C → ws_book.terms_and_conditions. The admin form has always sent
  // this; before 2026-08-18 there was no column, so it was silently discarded.
  termsAndConditions?: string | null;
  demoUrl?: string;
  demoFileName?: string | null;
  weight?: number;
  pages?: number;
  dynamicLink?: string;
  listPrice?: number;
  discountedPrice?: number;
  shippingPrice?: number;
  orderBy?: number;
  language?: string;
  isMagazine?: boolean;
  isCombo?: boolean;
  isTrending?: boolean;
  status?: boolean;
  examCountdownIds?: any;
  examCountdownCategoryIds?: any;
}

// ws_book NOT-NULL columns with no DB default → write-time sentinels.
const SENTINEL = { name: "", thumbnail: " ", pages: 0, dynamic_link: "", weight: 0, shipping_price: 0, order_by: 0 };

export const createBook = async (d: BookWriteInput) => {
  const now = new Date();
  // No explicit order → previous row + 1 (see utils/listOrdering).
  const bookOrder = d.orderBy ?? nextOrder((await prisma.book.findFirst({ orderBy: [{ created_at: "desc" }, { id: "desc" }], select: { order_by: true } }))?.order_by);
  const created = await repo.create({
    name: d.name ?? SENTINEL.name,
    thumbnail: d.thumbnail ?? SENTINEL.thumbnail,
    author: d.author ?? null,
    image: d.image ?? null,
    description: d.description ?? null,
    termsAndConditions: d.termsAndConditions ?? null,
    demo_url: d.demoUrl ?? null,
    demoFileName: d.demoFileName ?? null,
    weight: d.weight ?? SENTINEL.weight,
    pages: d.pages ?? SENTINEL.pages,
    dynamic_link: d.dynamicLink ?? SENTINEL.dynamic_link,
    list_price: d.listPrice ?? 0,
    discounted_price: d.discountedPrice ?? 0,
    shipping_price: d.shippingPrice ?? SENTINEL.shipping_price,
    order_by: bookOrder,
    language: d.language ?? "Gujarati",
    is_magazine: d.isMagazine ?? false,
    isCombo: d.isCombo ?? false,
    isTrending: d.isTrending ?? false,
    active: d.status ?? true,
    // C6: store the attached countdown/category SQL ids as JSON int-arrays.
    examCountdownIds: parseIdArray(d.examCountdownIds),
    examCountdownCategoryIds: parseIdArray(d.examCountdownCategoryIds),
    created_at: now,
    updated_at: now,
  });
  return toBookDto(created);
};

export const updateBook = async (id: number, d: BookWriteInput): Promise<ReturnType<typeof toBookDto> | null> => {
  if (!(await repo.findById(id))) return null;
  const data: any = { updated_at: new Date() };
  if (d.name !== undefined) data.name = d.name;
  if (d.thumbnail !== undefined) data.thumbnail = d.thumbnail;
  if (d.author !== undefined) data.author = d.author;
  if (d.image !== undefined) data.image = d.image;
  if (d.description !== undefined) data.description = d.description;
  if (d.termsAndConditions !== undefined) data.termsAndConditions = d.termsAndConditions ?? null;
  if (d.demoUrl !== undefined) {
    data.demo_url = d.demoUrl;
    // Clearing the demo PDF clears its original name too (unless one is set explicitly).
    if (!d.demoUrl && d.demoFileName === undefined) data.demoFileName = null;
  }
  if (d.demoFileName !== undefined) data.demoFileName = d.demoFileName ?? null;
  if (d.weight !== undefined) data.weight = d.weight;
  if (d.pages !== undefined) data.pages = d.pages;
  if (d.dynamicLink !== undefined) data.dynamic_link = d.dynamicLink;
  if (d.listPrice !== undefined) data.list_price = d.listPrice;
  if (d.discountedPrice !== undefined) data.discounted_price = d.discountedPrice;
  if (d.shippingPrice !== undefined) data.shipping_price = d.shippingPrice;
  if (d.orderBy !== undefined) data.order_by = d.orderBy;
  if (d.language !== undefined) data.language = d.language;
  if (d.isMagazine !== undefined) data.is_magazine = d.isMagazine;
  if (d.isCombo !== undefined) data.isCombo = d.isCombo;
  if (d.isTrending !== undefined) data.isTrending = d.isTrending;
  if (d.status !== undefined) data.active = d.status;
  // C6: only persist the JSON int-arrays when the payload includes them, so an
  // unrelated update doesn't wipe the stored countdown attachments.
  if (d.examCountdownIds !== undefined) data.examCountdownIds = parseIdArray(d.examCountdownIds);
  if (d.examCountdownCategoryIds !== undefined) data.examCountdownCategoryIds = parseIdArray(d.examCountdownCategoryIds);
  const updated = await repo.update(id, data);
  return toBookDto(updated);
};

export const deleteBook = async (id: number): Promise<boolean> => {
  if (!(await repo.findById(id))) return false;
  await repo.delete(id);
  return true;
};

export const toggleBookStatus = async (id: number): Promise<boolean | null> => {
  const row = await repo.findById(id);
  if (!row) return null;
  const updated = await repo.setStatus(id, !row.active);
  return updated.active;
};

export const toggleBookTrending = async (id: number): Promise<boolean | null> => {
  const row = await repo.findById(id);
  if (!row) return null;
  const updated = await repo.setTrending(id, !row.isTrending);
  return updated.isTrending;
};

export const reorderBooks = async (orders: Array<{ id: string; orderBy: number }>) => {
  await Promise.all(
    orders.map(({ id, orderBy }) => {
      const numId = parseBookId(id);
      return numId ? repo.setOrder(numId, orderBy) : Promise.resolve();
    })
  );
};

// ── orders: line items ─────────────────────────────────────────────────────────
// Legacy book orders keep their line items in the `order_items` JSON column;
// only orders created by the migrated book-order WRITE path have child
// ws_book_order_item rows. So we PREFER child rows and fall back to the JSON
// snapshot (the authoritative source for legacy orders) — matching the Mongo
// embedded items[] contract.
type OrderItemShape = { bookId: number | null; name: string | null; qty: number; price: number; shippingPrice: number };

const itemsFromChildRows = (rows: any[]): OrderItemShape[] =>
  rows.map((it) => ({ bookId: it.bookId ?? null, name: it.Book?.name ?? null, qty: it.qty, price: it.price, shippingPrice: it.shipping_price ?? 0 }));

const itemsFromJson = (json: string | null): OrderItemShape[] => {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((it: any) => ({
      bookId: it.item != null ? Number(it.item) : null,
      name: it.name ?? null,
      qty: Number(it.qty) || 0,
      price: Number(it.price) || 0,
      shippingPrice: Number(it.shippingPrice ?? it.shipping_price ?? 0) || 0,
    }));
  } catch {
    return [];
  }
};

// books: id → metadata, to hydrate the `bookId` populate shape.
const toOrderItemDto = (it: OrderItemShape, books: Map<number, any>) => {
  const book = it.bookId != null ? books.get(it.bookId) : undefined;
  return {
    bookId: book
      ? { _id: String(book.id), name: book.name, image: book.image ?? null, thumbnail: blankToNull(book.thumbnail), author: book.author ?? null }
      : it.bookId != null
      ? String(it.bookId)
      : null,
    name: it.name ?? book?.name ?? null,
    qty: it.qty,
    price: it.price,
    // PER-UNIT shipping charge, same basis as the sibling `price` — 0 when the
    // order qualified for free shipping (the waiver is baked into the stored
    // value at checkout) or the legacy JSON snapshot carried none. The report
    // renders one row per line, so the order-level sum on the parent row cannot
    // stand in for this: painting it onto every line multiply-counts shipping on
    // any multi-book order. Matches what the export already emits per line, and
    // what the customer-facing toMyItemDto has always returned.
    shippingPrice: it.shippingPrice ?? 0,
    // Per-book unit weight (from the hydrated book row); null when unknown.
    weight: book?.weight ?? null,
  };
};

// Shared query contract for the orders list + its CSV/Excel exports, so all three
// honor the identical param mapping (minus page/limit on the exports).
export interface OrderReportQuery {
  customerId?: string;
  bookId?: string;
  status?: string;
  state?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

// Shared filter resolution for the orders list + its exports. Returns null when a
// bookId filter matched no orders (force empty result, short-circuit before the
// expensive read). `search` is resolved cross-table (customer name/phone/email +
// book name on items) up front; receiptId is matched in-query (LIKE).
const resolveOrderOpts = async (q: OrderReportQuery) => {
  const customerId = q.customerId ? parseBookId(q.customerId) ?? undefined : undefined;
  const state = q.state ? parseBookId(q.state) ?? undefined : undefined;
  const fromDate = parseDayBound(q.fromDate, false);
  const toDate = parseDayBound(q.toDate, true);

  // Optional server-side bookId filter: restrict to orders containing that book.
  // Resolve the matching order keys up front; none → no orders, short-circuit.
  let bookOrderKeysIn: string[] | undefined;
  if (q.bookId) {
    const bookId = parseBookId(q.bookId);
    if (!bookId) return null;
    bookOrderKeysIn = await repo.findOrderKeysByBookId(bookId);
    if (!bookOrderKeysIn.length) return null;
  }

  let customerIdsIn: number[] | undefined;
  let orderIdsIn: string[] | undefined;
  let receiptSearch: string | undefined;
  if (q.search) {
    receiptSearch = q.search;
    [customerIdsIn, orderIdsIn] = await Promise.all([
      repo.findCustomerIdsBySearch(q.search),
      repo.findOrderKeysByBookSearch(q.search),
    ]);
  }

  return {
    customerId,
    status: q.status,
    state,
    fromDate,
    toDate,
    customerIdsIn,
    orderIdsIn,
    receiptSearch,
    bookOrderKeysIn,
    sortBy: q.sortBy ?? "createdAt",
    sortDir: (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
};

// An order row hydrated with its resolved line items, the referenced book map and
// the derived report totals. Shared intermediate for the list DTO + the export.
type EnrichedOrder = {
  row: any;
  lineItems: OrderItemShape[];
  books: Map<number, any>;
  totalWeight: number | null;
  shippingPrice: number | null;
};

// Resolve each order's line items (child rows preferred, else order_items JSON),
// hydrate the referenced books in one query, and derive the report totals.
const enrichOrders = async (rows: any[]): Promise<EnrichedOrder[]> => {
  const childRows = await repo.findOrderItems(rows.map((r) => r.receiptId));
  const childByKey = new Map<string, any[]>();
  for (const it of childRows) {
    const arr = childByKey.get(it.order_id) ?? [];
    arr.push(it);
    childByKey.set(it.order_id, arr);
  }
  const itemsByOrder = new Map<number, OrderItemShape[]>();
  for (const r of rows) {
    const child = childByKey.get(r.receiptId);
    itemsByOrder.set(r.id, child?.length ? itemsFromChildRows(child) : itemsFromJson(r.orderItems));
  }

  // Hydrate all referenced book ids in one query.
  const books = await loadBooks([...itemsByOrder.values()].flat());

  return rows.map((r) => {
    const lineItems = itemsByOrder.get(r.id) ?? [];
    // Derive report totals from the line items: total weight = Σ(unit weight × qty)
    // over books with a known weight; shipping price = Σ(unit shipping × qty).
    // Both scale by qty because both stored values are PER UNIT — this is the
    // total shipping actually charged on the order, the figure that reconciles
    // against ws_book_order.amount (= Σ (price + shipping) × qty at checkout).
    let totalWeight = 0;
    let anyWeight = false;
    let shippingPrice = 0;
    for (const it of lineItems) {
      const bk = it.bookId != null ? books.get(it.bookId) : undefined;
      if (bk?.weight != null) {
        totalWeight += bk.weight * it.qty;
        anyWeight = true;
      }
      shippingPrice += (it.shippingPrice ?? 0) * it.qty;
    }
    return { row: r, lineItems, books, totalWeight: anyWeight ? totalWeight : null, shippingPrice: lineItems.length ? shippingPrice : null };
  });
};

const toOrderListDto = ({ row: r, lineItems, books, totalWeight, shippingPrice }: EnrichedOrder) => ({
  _id: String(r.id),
  receiptId: r.receiptId,
  customerId: toCustomerDto(r.user),
  shippingId: toShippingDto(r.shipping),
  amount: Number(r.amount),
  status: r.status,
  // Courier AWB set via the /tracking PATCH; null until fulfilled.
  trackingId: r.trackingId != null ? String(r.trackingId) : null,
  totalWeight,
  shippingPrice,
  // Razorpay identifiers; empty gateway id (non-razorpay order) → null.
  razorpayOrderId: r.gatewayOrderId ? r.gatewayOrderId : null,
  razorpayPaymentId: r.gatewayPaymentId ?? null,
  items: lineItems.map((it) => toOrderItemDto(it, books)),
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export const listOrders = async (q: OrderReportQuery & { page: number; limit: number }) => {
  const opts = await resolveOrderOpts(q);
  if (!opts) return { items: [], total: 0 };

  const [rows, total] = await Promise.all([
    repo.listOrders({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countOrders(opts),
  ]);

  const enriched = await enrichOrders(rows);
  return { items: enriched.map(toOrderListDto), total };
};

// ── orders: CSV / Excel export ───────────────────────────────────────────────
// Entire filtered set (no pagination) and NO row cap — keyset-paged (id DESC, no deep
// OFFSET), enriched per batch (lakhs OK). One export ROW per book LINE — each order's
// items[] is flattened, repeating the order-level fields, to mirror the on-screen table.
const ORDERS_EXPORT_BATCH = 5000;

// IST (Asia/Kolkata, +5:30, no DST) `YYYY-MM-DD HH:mm:ss`, e.g. "2026-10-06 00:01:21"
// — unified with the Subscription / Test Series exports (was raw UTC ISO).
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtExportDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
};

type OrderExportRow = {
  orderDate: string;
  trackingId: string;
  bookName: string;
  totalWeight: number | string;
  phone: string;
  altPhone: string;
  customerName: string;
  address: string;
  city: string;
  pincode: string;
  state: string;
  price: number | string;
  shippingPrice: number | string;
  qty: number | string;
  totalPrice: number | string;
  weight: number | string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  status: string;
};

// Flatten one enriched batch of orders into export ROWS (one per book line).
const flattenOrdersToExportRows = (enriched: Awaited<ReturnType<typeof enrichOrders>>): OrderExportRow[] => {
  const out: OrderExportRow[] = [];
  for (const e of enriched) {
    const r = e.row;
    const cust = toCustomerDto(r.user);
    const ship = toShippingDto(r.shipping);
    // Delivery details prefer the shipping address; fall back to the customer.
    const base = {
      orderDate: fmtExportDate(r.createdAt),
      trackingId: r.trackingId != null ? String(r.trackingId) : "",
      totalWeight: e.totalWeight ?? "",
      phone: ship?.phone ?? cust?.phoneNumber ?? "",
      altPhone: ship?.alternatePhone ?? "",
      customerName: ship?.name ?? [cust?.firstName, cust?.lastName].filter(Boolean).join(" "),
      address: [ship?.address, ship?.address2].filter(Boolean).join(", "),
      city: ship?.city ?? "",
      pincode: ship?.pincode != null ? String(ship.pincode) : "",
      state: ship?.state != null ? String(ship.state) : "",
      razorpayOrderId: r.gatewayOrderId ? r.gatewayOrderId : "",
      razorpayPaymentId: r.gatewayPaymentId ?? "",
      status: r.status ?? "",
    };
    if (!e.lineItems.length) {
      // Orders with no resolvable line items still export one row (book cols blank).
      out.push({ ...base, bookName: "", price: "", shippingPrice: "", qty: "", totalPrice: "", weight: "" });
      continue;
    }
    for (const it of e.lineItems) {
      const bk = it.bookId != null ? e.books.get(it.bookId) : undefined;
      out.push({
        ...base,
        bookName: it.name ?? bk?.name ?? "",
        price: it.price,
        shippingPrice: it.shippingPrice ?? "",
        qty: it.qty,
        // (unit price + unit shipping) × qty — the same arithmetic checkout used
        // to build ws_book_order.amount, so this column now sums back to it.
        totalPrice: (it.price + (it.shippingPrice ?? 0)) * it.qty,
        weight: bk?.weight ?? "",
      });
    }
  }
  return out;
};

// Walk the whole filtered set in keyset batches (no cap); yields flattened export
// rows per batch. `opts` is the resolved order filter (caller handles the empty case).
async function* iterateOrderExportRows(opts: NonNullable<Awaited<ReturnType<typeof resolveOrderOpts>>>) {
  let beforeId: number | undefined;
  for (;;) {
    const rows = await repo.listOrdersPageKeyset(opts, beforeId, ORDERS_EXPORT_BATCH);
    if (!rows.length) break;
    yield flattenOrdersToExportRows(await enrichOrders(rows));
    if (rows.length < ORDERS_EXPORT_BATCH) break;
    beforeId = rows[rows.length - 1].id;
  }
}

// Column order matches the on-screen orders table (19 cols, one row per book line).
const ORDER_EXPORT_COLUMNS: { header: string; get: (r: OrderExportRow) => string | number }[] = [
  { header: "Order Date", get: (r) => r.orderDate },
  { header: "Tracking ID", get: (r) => r.trackingId },
  { header: "Book Name", get: (r) => r.bookName },
  { header: "Total Weight", get: (r) => r.totalWeight },
  { header: "Phone", get: (r) => r.phone },
  { header: "ALT Phone", get: (r) => r.altPhone },
  { header: "Customer Name", get: (r) => r.customerName },
  { header: "Address", get: (r) => r.address },
  { header: "City", get: (r) => r.city },
  { header: "Pincode", get: (r) => r.pincode },
  { header: "State", get: (r) => r.state },
  { header: "Price", get: (r) => r.price },
  { header: "Shipping Price", get: (r) => r.shippingPrice },
  { header: "Qty", get: (r) => r.qty },
  { header: "Total Price", get: (r) => r.totalPrice },
  { header: "Weight", get: (r) => r.weight },
  { header: "Order ID", get: (r) => r.razorpayOrderId },
  { header: "Payment ID", get: (r) => r.razorpayPaymentId },
  { header: "Status", get: (r) => r.status },
];

export const buildOrdersCsv = async (q: OrderReportQuery): Promise<string> => {
  const opts = await resolveOrderOpts(q);
  async function* rowBatches() {
    if (opts) {
      for await (const batch of iterateOrderExportRows(opts)) {
        yield batch.map((r) => ORDER_EXPORT_COLUMNS.map((c) => c.get(r)));
      }
    }
  }
  return buildCsvFromRowBatches(ORDER_EXPORT_COLUMNS.map((c) => c.header), rowBatches());
};

export const buildOrdersXlsx = async (q: OrderReportQuery): Promise<Buffer> => {
  const opts = await resolveOrderOpts(q);
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  const finished = new Promise<void>((resolve, reject) => {
    pass.once("end", resolve);
    pass.once("error", reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet("Book Orders");
  ws.columns = ORDER_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 20 }));
  if (opts) {
    for await (const batch of iterateOrderExportRows(opts)) {
      for (const r of batch) ws.addRow(ORDER_EXPORT_COLUMNS.map((c) => c.get(r))).commit();
    }
  }
  ws.commit();
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
};

// Streamed export source (async job path) — same rows/columns as the sync builders.
export async function orderExportSource(q: OrderReportQuery): Promise<ReportSource> {
  const opts = await resolveOrderOpts(q);
  return {
    worksheetName: "Book Orders",
    columnWidth: 20,
    headers: ORDER_EXPORT_COLUMNS.map((c) => c.header),
    rowBatches: (async function* () {
      if (opts) {
        for await (const batch of iterateOrderExportRows(opts)) {
          yield batch.map((r) => ORDER_EXPORT_COLUMNS.map((c) => c.get(r)));
        }
      }
    })(),
  };
}

/** Batch-load the books referenced by a set of line items, keyed by id. */
const loadBooks = async (items: OrderItemShape[]): Promise<Map<number, any>> => {
  const ids = [...new Set(items.map((i) => i.bookId).filter((id): id is number => id != null))];
  const rows = await repo.findBooksByIds(ids);
  return new Map(rows.map((b) => [b.id, b]));
};

export const getOrder = async (id: number) => {
  const order = await repo.findOrderById(id);
  if (!order) return null;
  const childRows = await repo.findOrderItems([order.receiptId]);
  const lineItems = childRows.length ? itemsFromChildRows(childRows) : itemsFromJson(order.orderItems);
  const books = await loadBooks(lineItems);
  return {
    _id: String(order.id),
    receiptId: order.receiptId,
    customerId: toCustomerDto(order.user),
    shippingId: toShippingDto(order.shipping),
    amount: Number(order.amount),
    status: order.status,
    paymentMethod: order.paymentMethod,
    gatewayOrderId: order.gatewayOrderId,
    gatewayPaymentId: order.gatewayPaymentId ?? null,
    trackingId: order.trackingId != null ? String(order.trackingId) : null,
    items: lineItems.map((it) => toOrderItemDto(it, books)),
    createdAt: order.createdAt ?? null,
    updatedAt: order.updatedAt ?? null,
  };
};

// ── book settings (ws_book_setting; single 'default' config row) ──────────────
// Mirrors the Mongo BookSetting doc shape.
const toBookSettingDto = (r: any) => ({
  _id: String(r.id),
  key: r.settingKey,
  freeShippingMinOrderAmount: r.freeShippingMinOrderAmount,
  supportPhone: r.supportPhone ?? undefined,
  termsAndConditions: Array.isArray(r.termsAndConditions) ? r.termsAndConditions : [],
  gstRate: r.gstRate,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export const getBookSettings = async () => {
  let row = await prisma.bookSetting.findFirst({ where: { settingKey: "default" } });
  if (!row) {
    const now = new Date();
    row = await prisma.bookSetting.create({
      data: { settingKey: "default", freeShippingMinOrderAmount: 0, gstRate: 0, termsAndConditions: [] as any, createdAt: now, updatedAt: now },
    });
  }
  return toBookSettingDto(row);
};

export const updateBookSettings = async (data: {
  freeShippingMinOrderAmount?: number; supportPhone?: string; termsAndConditions?: string[]; gstRate?: number;
}) => {
  const now = new Date();
  const upd: any = { updatedAt: now };
  if (data.freeShippingMinOrderAmount !== undefined) upd.freeShippingMinOrderAmount = data.freeShippingMinOrderAmount;
  if (data.gstRate !== undefined) upd.gstRate = data.gstRate;
  if (data.supportPhone !== undefined) upd.supportPhone = data.supportPhone;
  if (data.termsAndConditions !== undefined) upd.termsAndConditions = data.termsAndConditions as any;
  const row = await prisma.bookSetting.upsert({
    where: { settingKey: "default" },
    create: { settingKey: "default", freeShippingMinOrderAmount: data.freeShippingMinOrderAmount ?? 0, gstRate: data.gstRate ?? 0, supportPhone: data.supportPhone ?? null, termsAndConditions: (data.termsAndConditions ?? []) as any, createdAt: now, updatedAt: now },
    update: upd,
  });
  return toBookSettingDto(row);
};
