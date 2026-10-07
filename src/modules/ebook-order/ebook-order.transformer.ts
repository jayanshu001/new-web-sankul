// Ebook orders: row to DTO mapping (response shape is frozen).
import type { EBookOrder } from "@prisma/client";
import type { EbookOrderDto, EbookOrderRow, EbookOrderStatus } from "./ebook-order.types";

/** id → string, treating null/0 as unset. */
const idStr = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

export const toEbookOrderRow = (o: EBookOrder): EbookOrderRow => ({
  id: o.id,
  customerIdStr: o.userId != null ? String(o.userId) : null,
  planId: o.planId ?? null,
  status: o.status as EbookOrderStatus,
  razorpayOrderId: o.gatewayOrderId ?? null,
  razorpayPaymentId: o.gatewayPaymentId ?? null,
  orderPrice: o.orderPrice ?? 0,
  referrerId: o.referrerId ?? null,
  walletCoin: o.walletCoin ?? null,
});

/** Verify's `data.order`. `ebookId` comes from the plan: the order table has no ebook_id. */
export const toEbookOrderDto = (
  o: EBookOrder,
  ebookId: number | null
): EbookOrderDto => ({
  _id: String(o.id),
  customerId: o.userId ?? 0,
  ebookId: idStr(ebookId),
  planId: idStr(o.planId),
  orderType: "purchase",
  orderPrice: o.orderPrice ?? 0,
  status: o.status as EbookOrderStatus,
  razorpayOrderId: o.gatewayOrderId ?? null,
  razorpayPaymentId: o.gatewayPaymentId ?? null,
  createdAt: o.createdAt ?? null,
  updatedAt: o.updatedAt ?? null,
});
