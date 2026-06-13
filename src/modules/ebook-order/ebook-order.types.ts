/**
 * Ebook · Order (WRITE — Phase 3b) — MySQL (Prisma) branch types.
 *
 * Module key: `ebook-order`. The SECOND write-path module — rides the
 * commerce-order pattern (see src/modules/commerce-order). Gates the **ebook**
 * purchase flow across TWO endpoints:
 *   - POST /client/payment/create-order/ebook  (writes the pending order row)
 *   - POST /client/payment/verify              (ebook branch: order → complete +
 *                                               create/extend the EbookSubscription)
 *
 * Scope (docs/migration/WRITE_PATH_SCOPE.md): EBOOK after COURSE. Same
 * one-doc/two-tables split, dual-read fallback in verify, flag OFF until go-live.
 *
 * ── ONE-DOC vs TWO-TABLES ───────────────────────────────────────────────────
 * Mongo writes an `EbookOrder` doc; the verify branch flips it COMPLETE and
 * separately creates/extends an `EbookSubscription` doc. The verify RESPONSE
 * returns the ORDER (`data: {kind:"ebook", order}`), NOT the subscription — so
 * the verify DTO mirrors the Mongo EbookOrder doc. SQL splits the same way:
 *
 *   ws_ebook_order          — the payment / order-of-record
 *     status enum('cancel','complete','pending')
 *         │ order_id
 *         ▼
 *   ws_ebook_subscription   — the entitlement (created at verify; NOT returned)
 *     status tinyint(bool) · start_at · end_at · ebook_id · price
 *
 * Unlike course, there is NO tracking table here (2 tables, not 3).
 *
 * ── SCHEMA-DRIFT / FIELD-MAPPING NOTES (verified vs live DDL 2026-06-13) ─────
 *  - **`customer_id` TYPE SPLIT (same trap as course):** `ws_ebook_order.customer_id`
 *    is **VARCHAR(255)**, `ws_ebook_subscription.customer_id` is **INT**. Per C3
 *    the migrated customer id is INT; cast at the order boundary.
 *  - **NO `ebook_id` on the ORDER table** — only `plan_id`. The ebook is resolved
 *    via the plan (PackageCourseEbookPrice.ebook_id) at verify time. (Mongo's
 *    EbookOrder doc DOES carry ebookId; the DTO re-derives it from the plan.)
 *  - **order `status` enum ↔ Mongo status:** values are IDENTICAL strings
 *    ('pending'|'complete'|'cancel') — the Mongo EbookOrder.status enum uses the
 *    same strings, so NO translation is needed (simpler than course's
 *    paymentStatus mapping). The verify path flips pending → complete.
 *  - **`order_price` is the paid amount** (double) — there is no separate
 *    discount column on the ebook order (course used `discount_price`).
 *  - **`duration` is DAYS** (RESUME_HERE §6) — endAt via planDuration `asDays`.
 *  - **`payment_type` enum('online','backend')** — verify writes 'online'.
 *  - **EBookOrder.gatewayOrderId is non-null in Prisma** (DDL nullable) — we
 *    always set it at create-order, so this is safe.
 *
 * Ids are returned as strings (Mongo `_id`-shape) EXCEPT `customerId` (int).
 */

/** Order/subscription lifecycle — identical strings on SQL + Mongo. */
export type EbookOrderStatus = "pending" | "complete" | "cancel";

/**
 * The verify response's `data.order` — the Mongo-shaped EbookOrder doc,
 * reconstructed from the SQL ws_ebook_order row (+ the plan's ebook_id).
 */
export interface EbookOrderDto {
  _id: string;
  /** Int in the migrated id-space. */
  customerId: number;
  /** Re-derived from the plan (order table has no ebook_id). */
  ebookId: string | null;
  /** SQL `plan_id`. */
  planId: string | null;
  orderType: "purchase";
  /** ← order_price (the paid amount). */
  orderPrice: number;
  /** Same strings on SQL + Mongo. */
  status: EbookOrderStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Minimal order row for the verify owner-lookup fan-out: enough to dispatch
 * (already complete? which plan?) and fulfill.
 */
export interface EbookOrderRow {
  id: number;
  customerIdStr: string | null;
  planId: number | null;
  status: EbookOrderStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  orderPrice: number;
}

/** Result of the create-order write. */
export interface CreatedEbookOrder {
  orderId: number;
}
