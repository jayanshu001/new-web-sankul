/**
 * Book · Order (WRITE — Phase 3b) — MySQL (Prisma) branch types.
 *
 * Module key: `book-order`. The THIRD write-path module — a DIFFERENT shape from
 * course/ebook (cart checkout → 5 tables, line items, a courier AWB counter).
 * Scoped + signed off in docs/migration/BOOK_ORDER_SCOPE.md. Gates:
 *   - POST /client/payment/create-order        (writes order + order_item rows)
 *   - POST /client/payment/verify  (book branch: order→verified + tracking AWB +
 *                                   cart deactivation)
 *
 * ── FIVE TABLES ─────────────────────────────────────────────────────────────
 *   ws_book_order        — order-of-record (order_id VARCHAR business key = PK is
 *                          a separate int id; customer_id is INT here)
 *   ws_book_order_item   — line items (FK order_id = the VARCHAR business key)
 *   ws_book_cart / ws_book_cart_item — the cart (read at create-order; cart's
 *                          `status` flipped 0 at verify)
 *   ws_book_tracking     — courier tracking; tracking_id BIGINT AUTO_INCREMENT
 *                          doubles as the AWB (allocated on verify by inserting a
 *                          row); becomes ws_book_order.tracking_id
 *
 * ── SCHEMA-DRIFT / FIELD-MAPPING NOTES (verified vs live DDL 2026-06-13) ─────
 *  - **BIGINT overflow (FIXED):** `ws_book_tracking.tracking_id` + `ws_book_order
 *    .tracking_id` are BIGINT (AWB ~1.19e11, overflow Int32); Prisma mapped Int →
 *    reads THREW. Fixed `BookTracking.tracking_id Int→BigInt`, `BookOrder.trackingId
 *    Int?→BigInt?`, regenerated. Surfaced as number (fits a JS double).
 *  - **customer_id is INT** on ws_book_order (NOT the VARCHAR split of
 *    course/ebook orders). order_id is the VARCHAR business key (distinct from the
 *    int PK); order_item + tracking FK on that string.
 *  - **Embedded → child tables:** Mongo BookOrder.items[] → ws_book_order_item
 *    rows (+ a denormalized `order_items` TEXT blob on the order, NOT NULL — we
 *    write the JSON there too). Mongo BookCart.items[] → ws_book_cart_item rows.
 *  - **Tracking history LOSS:** Mongo tracking.history[] timeline has no SQL
 *    columns. SIGNED-OFF: persist the flat status row; the DTO SYNTHESIZES the
 *    single verify entry [{status:'Order Placed', note:'Payment received', at}].
 *  - **AWB via AUTO_INCREMENT:** verify inserts a ws_book_tracking row; the
 *    bigint auto-increment (live base 119400693004) is the next AWB. No Counter.
 *  - **NOT NULL with no obvious Mongo source:** cart_id, razorpay_order (TEXT),
 *    gateway_order_id — all populated at create-order.
 *  - **status is a VARCHAR** ('pending'|'verified'|...) — same strings as the
 *    Mongo BookOrderStatus enum; no translation.
 *
 * Ids returned as strings (Mongo `_id`-shape) EXCEPT customerId (int).
 */

export interface BookOrderItemDto {
  bookId: string | null;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
}

export interface BookOrderTrackingDto {
  trackingId: number | null;
  status: string;
  /** Synthesized from the flat row (SQL has no history columns). */
  history: { status: string; note?: string; at: Date | null }[];
}

/** The verify response's `data.order` — Mongo-shaped BookOrder. */
export interface BookOrderDto {
  _id: string;
  /** Mongo `receiptId` ← SQL order_id (VARCHAR business key). */
  receiptId: string;
  /** Int in the migrated id-space. */
  customerId: number;
  shippingId: string | null;
  items: BookOrderItemDto[];
  amount: number;
  status: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  tracking: BookOrderTrackingDto;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Minimal order row for the verify owner-lookup. */
export interface BookOrderRow {
  /** int PK. */
  id: number;
  /** VARCHAR business key (order_id) — child tables + tracking FK on this. */
  orderKey: string;
  customerId: number;
  shippingId: number | null;
  status: string;
  razorpayOrderId: string | null;
  trackingId: bigint | null;
}

/** A priced line item resolved at create-order (from the cart + books). */
export interface CreateOrderItemInput {
  bookId: number;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
}

export interface CreatedBookOrder {
  /** int PK. */
  orderId: number;
  /** VARCHAR business key. */
  orderKey: string;
}
