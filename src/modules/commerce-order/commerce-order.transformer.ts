// Course/package orders: row to DTO mapping (response shape is frozen).
import type {
  PackageCourseOrder,
  PackageCourseSubscription,
} from "@prisma/client";
import type {
  CourseOrderRow,
  OrderPaymentStatus,
  VerifiedCourseSubscriptionDto,
} from "./commerce-order.types";

/** Owner id → string, treating SQL's `0`/null sentinel as "unset" (→ null). */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

/**
 * bigint `tracking` FK → number (clients expect a number). Values are ~1.19e11, so this is
 * lossless; returns null above 2^53 rather than losing precision.
 */
const trackingToNumber = (v: bigint | null): number | null => {
  if (v == null) return null;
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
};

/** order.status enum → the paymentStatus enum clients parse. */
export const orderStatusToPaymentStatus = (
  s: "cancel" | "complete" | "pending"
): OrderPaymentStatus =>
  s === "complete" ? "verified" : s === "cancel" ? "failed" : "pending";

/** Decimal | number | null → number | null (Prisma Decimal has toNumber). */
const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number((v as { toString(): string }).toString());
  return Number.isFinite(n) ? n : null;
};

/**
 * Order row → the minimal `CourseOrderRow` the owner-lookup/dispatch needs.
 * `discount_price` (Prisma `amount`) is what the customer paid.
 */
export const toCourseOrderRow = (o: PackageCourseOrder): CourseOrderRow => ({
  id: o.id,
  customerIdStr: o.userId != null ? String(o.userId) : null,
  planId: o.planId ?? null,
  paymentStatus: orderStatusToPaymentStatus(o.status),
  razorpayOrderId: o.gatewayOrderId ?? null,
  razorpayPaymentId: o.gatewayPaymentId ?? null,
  amount: o.amount ?? null,
  referrerId: o.referrerId ?? null,
  walletCoin: o.wsCoin ?? null,
});

/**
 * Merges the order (payment facts) + subscription (entitlement facts) into the single
 * `data.subscription` object the verify course flow returns (frozen client shape).
 *
 *  - _id            ← subscription.id (the entitlement is the doc identity)
 *  - paymentStatus  ← order.status (mapped)
 *  - paidAmount     ← order.discount_price
 *  - razorpay*      ← order row
 *  - courseId/startAt/endAt/status/trackingId ← subscription row
 *  - packageId (plan)        ← pcb_id (subscription.planId)
 *  - targetPackageId (pkg)   ← package_id (subscription.packageId)
 */
export const toVerifiedCourseSubscriptionDto = (
  order: PackageCourseOrder,
  sub: PackageCourseSubscription
): VerifiedCourseSubscriptionDto => ({
  _id: String(sub.id),
  customerId: sub.customerId ?? order.userId ?? 0,
  courseId: ownerId(sub.courseId),
  targetPackageId: ownerId(sub.packageId),
  packageId: ownerId(sub.planId),
  startAt: sub.startAt ?? null,
  endAt: sub.endAt ?? null,
  status: sub.status,
  paidAmount: order.amount ?? null,
  paymentStatus: orderStatusToPaymentStatus(order.status),
  razorpayOrderId: order.gatewayOrderId ?? null,
  razorpayPaymentId: order.gatewayPaymentId ?? null,
  trackingId: trackingToNumber(sub.trackingId),
  createdAt: sub.createdAt ?? null,
  updatedAt: sub.updatedAt ?? null,
});

export { toNum };
