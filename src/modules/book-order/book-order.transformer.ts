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

/** AWB bigint → number (fits a JS double; ~1.19e11). */
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

/** Order row → minimal owner-lookup/dispatch row. */
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

/**
 * SQL ws_book_order (+ item rows) → the Mongo-shaped BookOrder doc the verify
 * book branch returns as `data.order`. The tracking `history[]` is SYNTHESIZED
 * (signed-off D-B3): SQL persists only the flat status, so on a verified order we
 * emit the single "Order Placed / Payment received" entry the Mongo path writes.
 */
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

// ── customer-facing order views (listMyOrders / getMyOrderById) ──────────────

/**
 * Synthesized tracking sub-doc (SQL persists only the flat status row). Verified
 * orders emit the single "Order Placed / Payment received" entry the Mongo verify
 * path writes; otherwise a pending shell. Same rule as `toBookOrderDto` (D-B3).
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

/** ws_customer_shipping row → the populated Mongo-shaped shipping sub-doc. */
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

/** Line item with `bookId` left as a string (list view — unpopulated). */
const toMyItemDto = (it: BookOrderItem): MyOrderItemDto => ({
  bookId: idStr(it.bookId),
  qty: it.qty,
  listPrice: it.list_price,
  price: it.price,
  shippingPrice: it.shipping_price,
});

/** Line item with `bookId` populated (detail view — Mongo `.populate`). */
const toMyItemDtoPopulated = (
  it: BookOrderItem & { Book?: Book | null }
): MyOrderItemDto => {
  const b = it.Book;
  return {
    bookId: b
      ? { _id: String(b.id), name: b.name, thumbnail: b.thumbnail ?? null, author: b.author ?? null }
      : idStr(it.bookId),
    qty: it.qty,
    listPrice: it.list_price,
    price: it.price,
    shippingPrice: it.shipping_price,
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

/** listMyOrders row → Mongo-shaped DTO (unpopulated shipping + book ids). */
export const toMyOrderListDto = (
  o: BookOrder,
  items: BookOrderItem[]
): MyOrderDto => buildBase(o, items.map(toMyItemDto), idStr(o.shippingId));

/** getMyOrderById row → Mongo-shaped DTO with populated shipping + books. */
export const toMyOrderDetailDto = (
  o: BookOrder & { shipping?: CustomerShipping | null },
  items: (BookOrderItem & { Book?: Book | null })[]
): MyOrderDto =>
  buildBase(
    o,
    items.map(toMyItemDtoPopulated),
    o.shipping ? toShippingDto(o.shipping) : idStr(o.shippingId)
  );

export { toNum };
