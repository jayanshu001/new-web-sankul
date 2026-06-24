import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminBookRepository as repo } from "./admin-book.repository";
import { parseIdArray, populateExamCountdowns } from "../exam-countdown/exam-countdown.service";
import type { Book } from "@prisma/client";

export const ADMIN_BOOK_MODULE = "admin-book";
export const isAdminBookMysql = (): boolean => isMysqlModule(ADMIN_BOOK_MODULE);

export const parseBookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// The Mongo defaults for the SQL-absent publication / deliveryEta fields
// (mirror catalog-book.transformer).
const DEFAULT_PUBLICATION = "WebSankul Publication";
const DEFAULT_DELIVERY_ETA = "5-7 days";

/**
 * `ws_book` row → admin Book DTO, shape-compatible with the Mongo `Book`
 * document. SQL-absent fields are synthesized: isTrending=false,
 * publication/deliveryEta defaults, termsAndConditions=null, demoFileName/
 * bookFileName=null, bookUrl=null (only demo_url exists), and packageIds = []
 * (no SQL column/table).
 *
 * examCountdownIds / examCountdownCategoryIds are stored as JSON int-arrays on
 * ws_book (C6). This base DTO returns them UNPOPULATED ([]) for list/order
 * surfaces; the single-book detail (`getBook`) resolves them to the Mongo
 * `.populate()` shape via `populateExamCountdowns`.
 */
// ws_book.thumbnail is NOT NULL, so create stores a " " (space) sentinel when no
// thumbnail is given. Normalise blank/whitespace back to null on read so the API
// signals "no thumbnail" correctly instead of leaking the sentinel.
const blankToNull = (v: string | null | undefined): string | null =>
  v != null && v.trim() !== "" ? v : null;

export const toBookDto = (row: Book) => ({
  _id: String(row.id),
  name: row.name,
  examCountdownCategoryId: null,
  examCountdownCategoryIds: [],
  examCountdownIds: [],
  packageIds: [],
  thumbnail: blankToNull(row.thumbnail),
  author: row.author ?? null,
  image: row.image ?? null,
  description: row.description ?? null,
  termsAndConditions: null,
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
  isTrending: false,
  status: row.active,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

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
export const listBooks = async (q: {
  search?: string;
  language?: string;
  isMagazine?: boolean;
  isCombo?: boolean;
  status?: boolean;
  page: number;
  limit: number;
}) => {
  const opts = { search: q.search, language: q.language, isMagazine: q.isMagazine, isCombo: q.isCombo, status: q.status };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
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
  status?: boolean;
  examCountdownIds?: any;
  examCountdownCategoryIds?: any;
}

// ws_book NOT-NULL columns with no DB default → write-time sentinels.
const SENTINEL = { name: "", thumbnail: " ", pages: 0, dynamic_link: "", weight: 0, shipping_price: 0, order_by: 0 };

export const createBook = async (d: BookWriteInput) => {
  const now = new Date();
  const created = await repo.create({
    name: d.name ?? SENTINEL.name,
    thumbnail: d.thumbnail ?? SENTINEL.thumbnail,
    author: d.author ?? null,
    image: d.image ?? null,
    description: d.description ?? null,
    demo_url: d.demoUrl ?? null,
    demoFileName: d.demoFileName ?? null,
    weight: d.weight ?? SENTINEL.weight,
    pages: d.pages ?? SENTINEL.pages,
    dynamic_link: d.dynamicLink ?? SENTINEL.dynamic_link,
    list_price: d.listPrice ?? 0,
    discounted_price: d.discountedPrice ?? 0,
    shipping_price: d.shippingPrice ?? SENTINEL.shipping_price,
    order_by: d.orderBy ?? SENTINEL.order_by,
    language: d.language ?? "Gujarati",
    is_magazine: d.isMagazine ?? false,
    isCombo: d.isCombo ?? false,
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
type OrderItemShape = { bookId: number | null; name: string | null; qty: number; price: number };

const itemsFromChildRows = (rows: any[]): OrderItemShape[] =>
  rows.map((it) => ({ bookId: it.bookId ?? null, name: it.Book?.name ?? null, qty: it.qty, price: it.price }));

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
  };
};

export const listOrders = async (q: {
  customerId?: string;
  bookId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page: number;
  limit: number;
}) => {
  const customerId = q.customerId ? parseBookId(q.customerId) ?? undefined : undefined;
  const fromDate = q.fromDate ? new Date(q.fromDate) : undefined;
  const toDate = q.toDate ? new Date(q.toDate) : undefined;

  // Optional server-side bookId filter: restrict to orders containing that book.
  // Resolve the matching order keys up front; none → no orders, short-circuit.
  let bookOrderKeysIn: string[] | undefined;
  if (q.bookId) {
    const bookId = parseBookId(q.bookId);
    if (!bookId) return { items: [], total: 0 };
    bookOrderKeysIn = await repo.findOrderKeysByBookId(bookId);
    if (!bookOrderKeysIn.length) return { items: [], total: 0 };
  }

  // Resolve the cross-table search (customer name/phone + book name on items)
  // up front; receiptId is matched in-query (LIKE).
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

  const opts = {
    customerId,
    status: q.status,
    fromDate,
    toDate,
    customerIdsIn,
    orderIdsIn,
    receiptSearch,
    bookOrderKeysIn,
    sortBy: q.sortBy ?? "createdAt",
    sortDir: (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
  };

  const [rows, total] = await Promise.all([
    repo.listOrders({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countOrders(opts),
  ]);

  // Resolve each order's line items (child rows preferred, else order_items JSON).
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

  const items = rows.map((r) => ({
    _id: String(r.id),
    receiptId: r.receiptId,
    customerId: toCustomerDto(r.user),
    shippingId: toShippingDto(r.shipping),
    amount: Number(r.amount),
    status: r.status,
    items: (itemsByOrder.get(r.id) ?? []).map((it) => toOrderItemDto(it, books)),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  }));

  return { items, total };
};

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
  originCity: r.originCity ?? undefined,
  originHub: r.originHub ?? undefined,
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
  freeShippingMinOrderAmount?: number; supportPhone?: string; termsAndConditions?: string[]; gstRate?: number; originCity?: string; originHub?: string;
}) => {
  const now = new Date();
  const upd: any = { updatedAt: now };
  if (data.freeShippingMinOrderAmount !== undefined) upd.freeShippingMinOrderAmount = data.freeShippingMinOrderAmount;
  if (data.gstRate !== undefined) upd.gstRate = data.gstRate;
  if (data.supportPhone !== undefined) upd.supportPhone = data.supportPhone;
  if (data.termsAndConditions !== undefined) upd.termsAndConditions = data.termsAndConditions as any;
  if (data.originCity !== undefined) upd.originCity = data.originCity;
  if (data.originHub !== undefined) upd.originHub = data.originHub;
  const row = await prisma.bookSetting.upsert({
    where: { settingKey: "default" },
    create: { settingKey: "default", freeShippingMinOrderAmount: data.freeShippingMinOrderAmount ?? 0, gstRate: data.gstRate ?? 0, supportPhone: data.supportPhone ?? null, termsAndConditions: (data.termsAndConditions ?? []) as any, originCity: data.originCity ?? null, originHub: data.originHub ?? null, createdAt: now, updatedAt: now },
    update: upd,
  });
  return toBookSettingDto(row);
};
