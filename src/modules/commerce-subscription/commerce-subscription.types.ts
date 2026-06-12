/**
 * Commerce · Subscription (READ) — MySQL (Prisma) branch types.
 *
 * Table: `ws_package_course_subscription` (Phase 3a, READ-ONLY; flag OFF until
 * the commerce-wave flip). 2 rows in staging. This is the **entitlement source
 * of truth** — a customer "owns" a course/package iff an active, unexpired row
 * exists. WRITES (create/extend on payment) are Phase 3b (verify.controller +
 * webhook); this module only reads.
 *
 * SCHEMA-DRIFT / FIELD-MAPPING NOTES (verified against the live DDL 2026-06-12):
 *
 *  - **`tracking` overflow (FIXED):** the SQL `tracking` column is `bigint`
 *    (values ~1.19e11, both staging rows overflow Int32) but the Prisma model
 *    mapped it as `Int?`, which would THROW on every read. Fixed the schema:
 *    `PackageCourseSubscription.trackingId Int? → BigInt?` and the referenced
 *    `PackageCourseSubscriptionTracking.id Int → BigInt`. The DTO surfaces it as
 *    a `number | null` (the Mongo model typed `trackingId` as Number) — safe
 *    because the value fits a JS double; see the transformer's coercion note.
 *
 *  - **`customer_id` is INT here** (NOT varchar like the order tables — that's
 *    the C3 seam). In the migrated id-space the customer IS the int id (see
 *    customer-auth), so this module takes/returns `customerId` as an int. The
 *    string→int resolution is the caller's boundary concern.
 *
 *  - **Mongo↔SQL name divergence (IMPORTANT):** the Mongo model's `packageId`
 *    is the PLAN ref (PackageCourseEbookPrice) — SQL `pcb_id` (`planId`). The
 *    Mongo `targetPackageId` is the actual package — SQL `package_id`
 *    (`packageId`). The DTO uses the Mongo NAMES so consumer predicates port
 *    1:1: `planId`→`packageId`(plan), `packageId`(pkg)→`targetPackageId`.
 *
 *  - **Mongo-only commerce/promo fields absent from this table:** promocodeId,
 *    promoterId, referrerId, paidAmount, customer/promoterPercentage,
 *    paymentStatus, razorpay*, paidAt live in the ORDER row / are 3b. They are
 *    intentionally NOT produced here — this is the entitlement read only.
 *
 *  - **`status` is the entitlement flag** (tinyint→bool). Active entitlement =
 *    `status = true AND end_at > now`. The Mongo `paymentStatus` enum is a
 *    SEPARATE concept and is not on this table.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible, EXCEPT
 * `customerId` which is an int in the migrated id-space.
 */

/** `ws_package_course_subscription` row → entitlement DTO (Mongo-named). */
export interface SubscriptionDto {
  _id: string;
  /** Int in the migrated id-space (SQL `customer_id` is int). */
  customerId: number;
  /** SQL `course_id`. Null for package subscriptions. */
  courseId: string | null;
  /** Mongo `targetPackageId` ← SQL `package_id` (the actual package). */
  targetPackageId: string | null;
  /** Mongo `packageId` ← SQL `pcb_id` — the PLAN row (PackageCourseEbookPrice). */
  packageId: string | null;
  /** Mongo `customerShippingId` ← SQL `shipping`. */
  customerShippingId: string | null;
  /** Mongo `trackingId` ← SQL `tracking` (bigint, coerced to number). */
  trackingId: number | null;
  startAt: Date | null;
  endAt: Date | null;
  /** Entitlement flag (SQL `status` tinyint). */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
