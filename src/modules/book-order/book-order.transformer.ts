// Book orders: row to DTO mapping (response shape is frozen).
import type { BookOrder, BookOrderItem, Book, CustomerShipping } from "@prisma/client";
import { buildTrackingUrl } from "../../config/courier";
import type {
  BookOrderDto,
  BookOrderItemDto,
  BookOrderTrackingDto,
  BookOrderRow,
  MyOrderDto,
  MyOrderItemDto,
  MyOrderShippingDto,
} from "./book-order.types";

const idStr = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

/** AWB bigint → number; null when it exceeds MAX_SAFE_INTEGER. */
const awbToNumber = (v: bigint | null): number | null => {
  if (v == null) return null;
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
};

const toNum = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number((v as { toString(): string }).toString());
  return Number.isFinite(n) ? n : 0;
};

export const toBookOrderRow = (o: BookOrder): BookOrderRow => ({
  id: o.id,
  orderKey: o.receiptId, // @map("order_id") — the VARCHAR business key
  customerId: o.userId ?? 0,
  shippingId: o.shippingId ?? null,
  status: o.status,
  razorpayOrderId: o.gatewayOrderId ?? null,
  trackingId: o.trackingId ?? null,
});

const toItemDto = (it: BookOrderItem): BookOrderItemDto => ({
  bookId: idStr(it.bookId),
  qty: it.qty,
  listPrice: it.list_price,
  price: it.price,
  shippingPrice: it.shipping_price,
});

/** The tracking `history[]` is synthesized; see `buildTracking`. */
export const toBookOrderDto = (
  o: BookOrder,
  items: BookOrderItem[]
): BookOrderDto => {
  const trackingId = awbToNumber(o.trackingId ?? null);
  const verified = o.status === "verified";
  return {
    _id: String(o.id),
    receiptId: o.receiptId,
    customerId: o.userId ?? 0,
    shippingId: idStr(o.shippingId),
    items: items.map(toItemDto),
    amount: toNum(o.amount),
    status: o.status,
    razorpayOrderId: o.gatewayOrderId ?? null,
    razorpayPaymentId: o.gatewayPaymentId ?? null,
    tracking: {
      trackingId,
      status: verified ? "Order Placed" : "pending",
      history:
        verified && trackingId != null
          ? [{ status: "Order Placed", note: "Payment received", at: o.updatedAt ?? null }]
          : [],
    },
    createdAt: o.createdAt ?? null,
    updatedAt: o.updatedAt ?? null,
  };
};

/**
 * Tracking is synthesized: only the flat status is persisted, so a verified order
 * gets a single "Order Placed / Payment received" entry.
 */
const buildTracking = (o: BookOrder): BookOrderTrackingDto => {
  const trackingId = awbToNumber(o.trackingId ?? null);
  const verified = o.status === "verified";
  return {
    trackingId,
    status: verified ? "Order Placed" : "pending",
    history:
      verified && trackingId != null
        ? [{ status: "Order Placed", note: "Payment received", at: o.updatedAt ?? null }]
        : [],
  };
};

const nullableStr = (v: string | null | undefined): string | null =>
  v == null || v === "" ? null : v;

const toShippingDto = (s: CustomerShipping): MyOrderShippingDto => ({
  _id: String(s.id),
  name: nullableStr(s.name),
  phone: s.phone != null ? String(s.phone) : null,
  alternatePhone: s.alternate_phone != null ? String(s.alternate_phone) : null,
  email: nullableStr(s.email),
  address: nullableStr(s.address),
  address2: nullableStr(s.address_2),
  city: nullableStr(s.city),
  stateId: s.state != null ? String(s.state) : null,
  pincode: s.pincode != null ? String(s.pincode) : null,
  status: s.status ?? null,
  createdAt: s.created_at ?? null,
  updatedAt: s.updated_at ?? null,
});

// ── order line items ────────────────────────────────────────────────────────
// Every book order carries its lines in the `order_items` JSON snapshot, in one of
// three shapes: legacy `{item,name,qty,list_price,price,shipping_price}`, older legacy
// `{item_id,qty,price,shipping_price,…}`, or SQL-checkout `{bookId,qty,listPrice,price,
// shippingPrice}`. Legacy carts kept a book REMOVED before checkout as a qty-0 line (in
// the JSON and the child row alike) — it was not bought (prod: the order total is exactly
// Σ (price + shipping) × qty over the qty > 0 lines), so qty <= 0 lines are dropped from
// both sources. The JSON is the source of truth whenever every remaining line has a book
// id; ws_book_order_item rows are only the fallback. ONE resolver for every reader
// (client my-orders + purchase history, admin report/export/detail, dashboard, receipts).
export type OrderLine = {
  bookId: number | null;
  name: string | null;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
};

const linesFromJson = (json: string | null): OrderLine[] => {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((it: any) => {
      const raw = it?.bookId ?? it?.item ?? it?.item_id;
      return {
        bookId: raw != null && Number.isInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null,
        name: it?.name ?? null,
        qty: Number(it?.qty) || 0,
        listPrice: Number(it?.listPrice ?? it?.list_price ?? 0) || 0,
        price: Number(it?.price) || 0,
        shippingPrice: Number(it?.shippingPrice ?? it?.shipping_price ?? 0) || 0,
      };
    });
  } catch {
    return [];
  }
};

const linesFromRows = (rows: any[]): OrderLine[] =>
  rows.map((it) => ({
    bookId: it.bookId ?? null,
    name: it.Book?.name ?? null,
    qty: it.qty ?? 0,
    listPrice: it.list_price ?? 0,
    price: it.price ?? 0,
    shippingPrice: it.shipping_price ?? 0,
  }));

const bought = (lines: OrderLine[]) => lines.filter((it) => it.qty > 0);

/** An order's bought lines (qty > 0): the order_items JSON when every line has a book id, else its child rows. */
export const resolveOrderLines = (json: string | null, childRows: any[]): OrderLine[] => {
  const fromJson = bought(linesFromJson(json));
  const jsonOk = fromJson.length > 0 && fromJson.every((it) => it.bookId != null);
  return jsonOk || !childRows.length ? fromJson : bought(linesFromRows(childRows));
};

/** Distinct book ids referenced by a set of lines — for the one batched book lookup. */
export const orderLineBookIds = (lines: OrderLine[]): number[] =>
  [...new Set(lines.map((l) => l.bookId).filter((id): id is number => id != null))];

export type OrderLineBook = Pick<Book, "id" | "name" | "thumbnail" | "author">;

/** Line item with `bookId` left as a string (list view — unpopulated). */
const toMyItemDto = (it: OrderLine): MyOrderItemDto => ({
  bookId: idStr(it.bookId),
  qty: it.qty,
  listPrice: it.listPrice,
  price: it.price,
  shippingPrice: it.shippingPrice,
});

/** Line item with `bookId` populated (detail view — Mongo `.populate`). */
const toMyItemDtoPopulated = (it: OrderLine, books: Map<number, OrderLineBook>): MyOrderItemDto => {
  const b = it.bookId != null ? books.get(it.bookId) : undefined;
  return {
    ...toMyItemDto(it),
    bookId: b
      ? { _id: String(b.id), name: b.name, thumbnail: b.thumbnail ?? null, author: b.author ?? null }
      : idStr(it.bookId),
  };
};

const buildBase = (
  o: BookOrder,
  items: MyOrderItemDto[],
  shippingId: string | MyOrderShippingDto | null
): MyOrderDto => {
  const tracking = buildTracking(o);
  return {
    _id: String(o.id),
    receiptId: o.receiptId,
    customerId: o.userId ?? 0,
    shippingId,
    items,
    orderType: o.orderType,
    paymentMethod: o.paymentMethod,
    amount: toNum(o.amount),
    status: o.status,
    razorpayOrderId: o.gatewayOrderId ?? null,
    razorpayPaymentId: o.gatewayPaymentId ?? null,
    tracking,
    paidAt: o.paidAt ?? null,
    createdAt: o.createdAt ?? null,
    updatedAt: o.updatedAt ?? null,
    trackingUrl: buildTrackingUrl(tracking.trackingId),
  };
};

export const toMyOrderListDto = (
  o: BookOrder,
  lines: OrderLine[]
): MyOrderDto => buildBase(o, lines.map(toMyItemDto), idStr(o.shippingId));

export const toMyOrderDetailDto = (
  o: BookOrder & { shipping?: CustomerShipping | null },
  lines: OrderLine[],
  books: Map<number, OrderLineBook>
): MyOrderDto =>
  buildBase(
    o,
    lines.map((it) => toMyItemDtoPopulated(it, books)),
    o.shipping ? toShippingDto(o.shipping) : idStr(o.shippingId)
  );

export { toNum };
