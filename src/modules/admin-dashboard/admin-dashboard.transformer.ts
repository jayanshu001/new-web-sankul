/**
 * Admin dashboard recent-list DTOs. Map raw Prisma rows (`amount`, `package`,
 * `customer`, `orderItems` JSON …) onto the frozen populated shape the admin UI parses
 * (`paidAmount`, `targetPackageId`, `customerId`, `items[].bookId` …).
 */
import { splitFullName } from "../customer-profile/customer-profile.name";
import type { OrderLine } from "../book-order/book-order.transformer";

const num = (v: any) => (v == null ? 0 : Number(v));

export const toCustomerRef = (c: any) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber ?? null };
};

const toCatalogRef = (r: any) =>
  r ? { _id: String(r.id), name: r.name, image: r.image ?? null } : null;

export const toPackageSubDto = (row: any) => ({
  _id: String(row.id),
  paidAmount: num(row.amount),
  createdAt: row.createdAt ?? null,
  customerId: toCustomerRef(row.customer),
  targetPackageId: toCatalogRef(row.package),
});

export const toCourseSubDto = (row: any) => ({
  _id: String(row.id),
  paidAmount: num(row.amount),
  createdAt: row.createdAt ?? null,
  customerId: toCustomerRef(row.customer),
  courseId: toCatalogRef(row.course),
});

export const toEbookSubDto = (row: any) => ({
  _id: String(row.id),
  paidAmount: num(row.price),
  createdAt: row.createdAt ?? null,
  customerId: toCustomerRef(row.customer),
  ebookId: toCatalogRef(row.eBook),
});

// TestSeries/LiveCourse subscription models have only scalar FKs (no Prisma relations),
// so refs arrive as pre-loaded maps. ws_test_series title/thumbnail → UI name/image.
export const toTestSeriesSubDto = (row: any, customers: Map<number, any>, series: Map<number, any>) => {
  const ts = row.testSeriesId != null ? series.get(row.testSeriesId) : null;
  return {
    _id: String(row.id),
    // `price` → `amount` (2026-08-31 rename); reading `price` showed every row as ₹0.
    paidAmount: num(row.amount),
    status: row.status,
    createdAt: row.createdAt ?? null,
    customerId: toCustomerRef(row.customerId != null ? customers.get(row.customerId) : null),
    testSeriesId: ts ? { _id: String(ts.id), name: ts.title, image: ts.thumbnail ?? null } : null,
  };
};

/**
 * Fed a ws_live_course_order row, whose `status` is "complete"/"pending"/"cancel";
 * normalised back to the boolean the response has always carried. `row.amount` is
 * discount_price, the same column the package/course rows use.
 */
export const toLiveCourseSubDto = (row: any, customers: Map<number, any>, courses: Map<number, any>) => ({
  _id: String(row.id),
  paidAmount: num(row.amount),
  status: typeof row.status === "boolean" ? row.status : row.status === "complete",
  createdAt: row.createdAt ?? null,
  customerId: toCustomerRef(row.customerId != null ? customers.get(row.customerId) : null),
  liveCourseId: toCatalogRef(row.liveCourseId != null ? courses.get(row.liveCourseId) : null),
});

// ── recent book orders (items[].bookId populated) ──────────────────────────────
// Line items are resolved by book-order's resolveOrderLines (order_items JSON
// preferred, else ws_book_order_item rows) — mirroring admin-book's getOrder contract.

const toOrderItemDto = (it: OrderLine, books: Map<number, any>) => {
  const book = it.bookId != null ? books.get(it.bookId) : undefined;
  return {
    bookId: book
      ? { _id: String(book.id), name: book.name, image: book.image ?? null }
      : it.bookId != null
      ? String(it.bookId)
      : null,
    name: it.name ?? book?.name ?? null,
    qty: it.qty,
    price: it.price,
  };
};

export const toBookOrderDto = (row: any, items: OrderLine[], books: Map<number, any>) => ({
  _id: String(row.id),
  receiptId: row.receiptId,
  amount: num(row.amount),
  status: row.status,
  createdAt: row.createdAt ?? null,
  items: items.map((it) => toOrderItemDto(it, books)),
});
