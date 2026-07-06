/**
 * Admin dashboard — recent-list DTOs. The SQL service fetches raw Prisma rows
 * with generated relation/column names (`amount`, `package`, `customer`,
 * `orderItems` JSON …); the admin UI expects the legacy Mongo-populated shape
 * (`paidAmount`, `targetPackageId`, `customerId`, `items[].bookId` …). These
 * transformers keep the response contract identical to the old populate() output.
 *
 * Customer name: MySQL `full_name` is one column but the UI wants
 * firstName/lastName — split on read via {@link splitFullName} (shared helper).
 */
import { splitFullName } from "../customer-profile/customer-profile.name";

const num = (v: any) => (v == null ? 0 : Number(v));

// ── populated ref sub-objects ──────────────────────────────────────────────────
export const toCustomerRef = (c: any) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber ?? null };
};

const toCatalogRef = (r: any) =>
  r ? { _id: String(r.id), name: r.name, image: r.image ?? null } : null;

// ── recent subscription rows ───────────────────────────────────────────────────
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

// TestSeries/LiveCourse subscription models have only scalar FKs (no Prisma
// relations), so refs are passed in as pre-loaded maps. ws_test_series uses
// title/thumbnail → mapped to the UI's name/image.
export const toTestSeriesSubDto = (row: any, customers: Map<number, any>, series: Map<number, any>) => {
  const ts = row.testSeriesId != null ? series.get(row.testSeriesId) : null;
  return {
    _id: String(row.id),
    paidAmount: num(row.price),
    status: row.status,
    createdAt: row.createdAt ?? null,
    customerId: toCustomerRef(row.customerId != null ? customers.get(row.customerId) : null),
    testSeriesId: ts ? { _id: String(ts.id), name: ts.title, image: ts.thumbnail ?? null } : null,
  };
};

export const toLiveCourseSubDto = (row: any, customers: Map<number, any>, courses: Map<number, any>) => ({
  _id: String(row.id),
  paidAmount: num(row.paidAmount),
  status: row.status,
  createdAt: row.createdAt ?? null,
  customerId: toCustomerRef(row.customerId != null ? customers.get(row.customerId) : null),
  liveCourseId: toCatalogRef(row.liveCourseId != null ? courses.get(row.liveCourseId) : null),
});

// ── recent book orders (items[].bookId populated) ──────────────────────────────
// Legacy book orders keep line items in the `order_items` JSON snapshot; migrated
// write-path orders have child ws_book_order_item rows. Prefer child rows, fall
// back to JSON — mirroring admin-book's getOrder contract.
type OrderItemShape = { bookId: number | null; name: string | null; qty: number; price: number };

export const itemsFromChildRows = (rows: any[]): OrderItemShape[] =>
  rows.map((it) => ({ bookId: it.bookId ?? null, name: it.Book?.name ?? null, qty: it.qty, price: it.price }));

export const itemsFromJson = (json: string | null): OrderItemShape[] => {
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

const toOrderItemDto = (it: OrderItemShape, books: Map<number, any>) => {
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

export const toBookOrderDto = (row: any, items: OrderItemShape[], books: Map<number, any>) => ({
  _id: String(row.id),
  receiptId: row.receiptId,
  amount: num(row.amount),
  status: row.status,
  createdAt: row.createdAt ?? null,
  items: items.map((it) => toOrderItemDto(it, books)),
});
