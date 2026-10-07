// Ebook orders: DTO and row types.

/**
 * ws_ebook_order (payment, order of record) → order_id → ws_ebook_subscription
 * (entitlement, created at verify). Verify returns the ORDER, not the
 * subscription. No tracking table.
 *
 *  - `customer_id` is VARCHAR on the order table, INT on the subscription.
 *  - The order table has no `ebook_id`; it is resolved via the plan.
 *  - `order_price` is the paid amount (no separate discount column).
 *  - `duration` is in DAYS.
 *  - `payment_type` enum('online','backend'); verify writes 'online'.
 *  - `gatewayOrderId` is non-null in Prisma but nullable in DDL; always set at create.
 */

export type EbookOrderStatus = "pending" | "complete" | "cancel";

/** The verify response's `data.order`. */
export interface EbookOrderDto {
  _id: string;
  customerId: number;
  /** From the plan (order table has no ebook_id). */
  ebookId: string | null;
  planId: string | null;
  orderType: "purchase";
  /** The paid amount. */
  orderPrice: number;
  status: EbookOrderStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface EbookOrderRow {
  id: number;
  customerIdStr: string | null;
  planId: number | null;
  status: EbookOrderStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  orderPrice: number;
  /** Set when a referral code was used. */
  referrerId: number | null;
  /** Debited at verify. */
  walletCoin: number | null;
}

export interface CreatedEbookOrder {
  orderId: number;
}
