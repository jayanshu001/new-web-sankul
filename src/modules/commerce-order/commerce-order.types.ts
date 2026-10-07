// Course/package orders: DTO and row types.
/**
 * Course purchase flow:
 *   - POST /client/payment/create-order/course  writes the pending order row only
 *   - POST /client/payment/verify               flips it to complete and writes the
 *                                               subscription + tracking in one $transaction
 *
 * The client contract is one subscription object carrying both order facts (razorpay ids,
 * paidAmount, paymentStatus) and entitlement facts (startAt, endAt, status). The tables split it:
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
 * so `data.subscription` is rebuilt by merging order payment fields onto the subscription row.
 *
 * Field notes:
 *  - `customer_id` type split: VARCHAR on the order table, INT on the subscription table
 *    (same logical id). Cast int→string when writing the order; never assume one type.
 *  - `tracking` is BIGINT (~1.19e11, overflows Int32); surfaced as `number | null`.
 *  - `order.status` ↔ `paymentStatus`: pending↔pending, complete↔verified, cancel↔failed.
 *  - API `packageId` = the PLAN (`pcb_id`); API `targetPackageId` = the package (`package_id`).
 *    Course subs set `course_id` and leave `package_id` null.
 *  - `tracking.order` references order.id, not subscription.id.
 *  - `duration` is DAYS: endAt via planDuration.
 *  - `payment_type` enum('backend','online'); verify writes 'online'.
 *
 * Ids are strings (frozen `_id` shape), except `customerId` which is an int.
 */

export type OrderPaymentStatus = "pending" | "verified" | "failed";

/** The verify response's `data.subscription`; the field set is frozen for the app. */
export interface VerifiedCourseSubscriptionDto {
  /** subscription row id (the entitlement). */
  _id: string;
  customerId: number;
  courseId: string | null;
  /** ← `package_id` (null for course subs). */
  targetPackageId: string | null;
  /** ← `pcb_id`: the PLAN row. */
  packageId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: boolean;
  /** ← order.discount_price (what the customer paid). */
  paidAmount: number | null;
  /** ← order.status, mapped. */
  paymentStatus: OrderPaymentStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  /** ← subscription.tracking (bigint, coerced to number). */
  trackingId: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Minimal order row the owner lookup needs to dispatch and fulfill. */
export interface CourseOrderRow {
  id: number;
  customerIdStr: string | null;
  planId: number | null;
  /** Mapped from order.status. */
  paymentStatus: OrderPaymentStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  /** order.discount_price — amount paid. */
  amount: number | null;
  /** Set when a referral code was used. */
  referrerId: number | null;
  /** Wallet coins redeemed; debited at verify. */
  walletCoin: number | null;
}

export interface CreatedCourseOrder {
  orderId: number;
}
