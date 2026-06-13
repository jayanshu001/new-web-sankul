import type { BookOrder, BookOrderItem } from "@prisma/client";
import type {
  BookOrderDto,
  BookOrderItemDto,
  BookOrderRow,
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

export { toNum };
