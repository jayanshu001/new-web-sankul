/**
 * Commerce · Order (WRITE — Phase 3b) — MySQL (Prisma) branch types.
 *
 * Module key: `commerce-order`. This is the FIRST write-path module. It gates the
 * **course** purchase flow end-to-end across TWO endpoints:
 *   - POST /client/payment/create-order/course  (writes the pending order row)
 *   - POST /client/payment/verify               (course branch: flips → verified,
 *                                                 writes the entitlement + tracking)
 *
 * Scope decisions (docs/migration/WRITE_PATH_SCOPE.md, signed off 2026-06-13):
 *   - COURSE path only (ebook/book ride the same pattern later).
 *   - create-order writes the `ws_package_course_order` row ONLY.
 *   - verify writes `ws_package_course_subscription` (+ `_subscription_tracking`)
 *     in ONE Prisma $transaction; upsert-extend reproduced in SQL.
 *   - DUAL-READ FALLBACK in verify's owner lookup (the rollback safety net):
 *     a flag flip between create-order and verify must not orphan a payment.
 *   - Flag stays OFF until a separate go-live sign-off.
 *
 * ── THE ONE-DOC-vs-THREE-TABLES IMPEDANCE MISMATCH ──────────────────────────
 * Mongo's `PackageCourseSubscription` doc carries BOTH the order facts (razorpay
 * ids, paidAmount, paymentStatus pending→verified) AND the entitlement facts
 * (startAt, endAt, status) in one document. SQL splits this:
 *
 *   ws_package_course_order          — the payment / order-of-record
 *     status enum('cancel','complete','pending')   ← order lifecycle
 *         │ order_id
 *         ▼
 *   ws_package_course_subscription   — the entitlement / access grant
 *     status tinyint(bool) · start_at · end_at      ← only exists once paid
 *     tracking BIGINT
 *         │ order (= order.id, NOT subscription.id)
 *         ▼
 *   ws_package_course_subscription_tracking
 *
 * So the verify response (which returns the full Mongo subscription doc as
 * `data.subscription`) is reconstructed by MERGING order payment fields onto the
 * subscription entitlement row — see `VerifiedCourseSubscriptionDto`.
 *
 * ── SCHEMA-DRIFT / FIELD-MAPPING NOTES (verified vs live DDL 2026-06-13) ─────
 *  - **`customer_id` TYPE SPLIT (the trap):** `ws_package_course_order.customer_id`
 *    is **VARCHAR(255)** but `ws_package_course_subscription.customer_id` is
 *    **INT**. Same logical id (staging confirms both hold "472335"). Per C3 the
 *    migrated customer id is an INT — we cast int→string when writing the order
 *    row, and use the int directly on the subscription row. Never assume one type
 *    across both tables.
 *  - **`tracking` / tracking.id BIGINT:** values ~1.19e11 overflow Int32. Prisma
 *    models them as `BigInt` (already correct in schema.prisma). Surfaced as
 *    `number | null` (Mongo typed `trackingId` as Number; fits a JS double).
 *  - **`order.status` enum** ('cancel'|'complete'|'pending') ↔ Mongo
 *    `paymentStatus` ('pending'|'verified'|'failed'): pending↔pending,
 *    complete↔verified, cancel↔failed. The verify path flips pending→complete.
 *  - **Mongo↔SQL name divergence:** Mongo `packageId` = the PLAN = SQL `pcb_id`
 *    (`planId`); Mongo `targetPackageId` = the package = SQL `package_id`
 *    (`packageId`). Course subs set `course_id`, leave `package_id` null.
 *  - **`tracking.order` FKs order.id**, not subscription.id.
 *  - **`duration` is DAYS** (RESUME_HERE §6) — endAt via planDuration `asDays`.
 *  - **`payment_type` enum('backend','online')** — verify writes 'online'.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible, EXCEPT
 * `customerId` which is an int in the migrated id-space.
 */

/** Order lifecycle ↔ Mongo paymentStatus mapping. */
export type OrderPaymentStatus = "pending" | "verified" | "failed";

/**
 * The verify response's `data.subscription` object — the full Mongo-shaped
 * subscription doc, reconstructed by merging the SQL ORDER payment fields onto
 * the SQL SUBSCRIPTION entitlement row. Mirrors the fields the Mongo course
 * branch returns (PackageCourseSubscription doc) so the response stays
 * byte-compatible for the app.
 */
export interface VerifiedCourseSubscriptionDto {
  /** subscription row id (the entitlement), Mongo `_id`-shape. */
  _id: string;
  /** Int in the migrated id-space. */
  customerId: number;
  /** SQL `course_id`. Set for course subscriptions. */
  courseId: string | null;
  /** Mongo `targetPackageId` ← SQL `package_id` (null for course subs). */
  targetPackageId: string | null;
  /** Mongo `packageId` ← SQL `pcb_id` — the PLAN row. */
  packageId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: boolean;
  /** ← order.discount_price (what the customer paid). */
  paidAmount: number | null;
  /** ← order.status, mapped to the Mongo enum. */
  paymentStatus: OrderPaymentStatus;
  /** ← order.razorpay_order_id. */
  razorpayOrderId: string | null;
  /** ← order.razorpay_payment_id. */
  razorpayPaymentId: string | null;
  /** ← subscription.tracking (bigint, coerced to number). */
  trackingId: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Minimal order row as seen by the owner-lookup fan-out: enough to dispatch
 * (is this a course order? already verified?) and to fulfill.
 */
export interface CourseOrderRow {
  id: number;
  customerIdStr: string | null;
  planId: number | null;
  /** Mongo paymentStatus, mapped from SQL order.status. */
  paymentStatus: OrderPaymentStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  /** order.discount_price — amount paid. */
  amount: number | null;
}

/** Result of the create-order write: the pending order row's id + receipt. */
export interface CreatedCourseOrder {
  orderId: number;
}
