// Package/course subscriptions: DTO type.

/**
 * Entitlement DTO. A customer owns a course/package iff an active, unexpired row
 * exists (`status = true AND end_at > now`). Ids are strings except `customerId`.
 */
export interface SubscriptionDto {
  _id: string;
  customerId: number;
  /** Null for package subscriptions. */
  courseId: string | null;
  /** SQL `package_id` (the actual package). */
  targetPackageId: string | null;
  /** SQL `pcb_id`: the PLAN row (PackageCourseEbookPrice), not the package. */
  packageId: string | null;
  /** SQL `shipping`. */
  customerShippingId: string | null;
  /** SQL `tracking` (bigint, coerced to number). */
  trackingId: number | null;
  startAt: Date | null;
  endAt: Date | null;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
