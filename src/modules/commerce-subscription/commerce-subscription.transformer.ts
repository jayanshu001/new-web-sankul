import type { PackageCourseSubscription } from "@prisma/client";
import type { SubscriptionDto } from "./commerce-subscription.types";

/** Owner id → string, treating SQL's `0` sentinel as "unset" (→ null). */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

/**
 * Coerce the bigint `tracking` FK to a JS number. Values are ~1.19e11, far
 * below Number.MAX_SAFE_INTEGER (~9.0e15), so this is lossless; the Mongo model
 * typed `trackingId` as Number, so a number keeps the response shape. Guard
 * against the (currently impossible) >2^53 case by returning null rather than
 * silently losing precision.
 */
const trackingToNumber = (v: bigint | null): number | null => {
  if (v == null) return null;
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
};

/**
 * `ws_package_course_subscription` row → entitlement DTO, using the Mongo FIELD
 * NAMES (see types.ts) so consumer predicates port 1:1:
 *  - SQL `pcb_id` (planId)   → Mongo `packageId`        (the plan row)
 *  - SQL `package_id`        → Mongo `targetPackageId`  (the actual package)
 *  - SQL `course_id`         → `courseId`
 *  - SQL `shipping`          → `customerShippingId`
 *  - SQL `tracking` (bigint) → `trackingId` (number)
 *
 * Mongo-only commerce/promo fields (promocodeId, paidAmount, paymentStatus,
 * razorpay*, …) are NOT produced — they live on the order row / are 3b.
 * `customerId` stays an int (the migrated id-space).
 */
export const toSubscriptionDto = (row: PackageCourseSubscription): SubscriptionDto => ({
  _id: String(row.id),
  customerId: row.customerId ?? 0,
  courseId: ownerId(row.courseId),
  targetPackageId: ownerId(row.packageId), // SQL package_id → Mongo targetPackageId
  packageId: ownerId(row.planId), // SQL pcb_id (plan) → Mongo packageId
  customerShippingId: ownerId(row.shippingId),
  trackingId: trackingToNumber(row.trackingId),
  startAt: row.startAt ?? null,
  endAt: row.endAt ?? null,
  status: row.status,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
