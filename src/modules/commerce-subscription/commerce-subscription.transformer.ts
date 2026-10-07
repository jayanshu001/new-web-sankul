// Package/course subscriptions: row to DTO mapping (response shape is frozen).
import type { PackageCourseSubscription } from "@prisma/client";
import type { SubscriptionDto } from "./commerce-subscription.types";

/** Owner id → string, treating SQL's `0` sentinel as "unset" (→ null). */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

/**
 * bigint `tracking` → number (response shape is numeric). Values (~1.19e11) are
 * well below 2^53; anything larger returns null rather than losing precision.
 */
const trackingToNumber = (v: bigint | null): number | null => {
  if (v == null) return null;
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
};

/**
 * DTO keeps the legacy field names: `packageId` is the PLAN (SQL `pcb_id`),
 * `targetPackageId` is the package (SQL `package_id`).
 */
export const toSubscriptionDto = (row: PackageCourseSubscription): SubscriptionDto => ({
  _id: String(row.id),
  customerId: row.customerId ?? 0,
  courseId: ownerId(row.courseId),
  targetPackageId: ownerId(row.packageId),
  packageId: ownerId(row.planId),
  customerShippingId: ownerId(row.shippingId),
  trackingId: trackingToNumber(row.trackingId),
  startAt: row.startAt ?? null,
  endAt: row.endAt ?? null,
  status: row.status,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
