/**
 * Commerce · Subscription (READ) service — dual-path (MySQL/Prisma ↔ Mongo).
 *
 * Module key: `commerce-subscription` (Phase 3a, READ-ONLY). Table:
 * `ws_package_course_subscription` (2 rows) — the **entitlement source of
 * truth**. Exposes purpose-built entitlement queries (active-ownership checks,
 * per-customer listings, active-owner counts) that mirror the dominant Mongo
 * consumer predicates 1:1.
 *
 * WRITES (create/extend on payment) are Phase 3b — NOT here.
 *
 * Built dual-path but kept flag OFF: subscription rows are joined by int-id
 * catalog (package/course/plan) and the int customer id-space, and read by
 * still-Mongo consumers (lecture/progress/dashboard/purchase-history). It flips
 * together with catalog + the rest of 3a in one consistent int id-space (the
 * commerce-wave flip). Verify via live-DB tsx, not HTTP, while OFF.
 *
 * C3 seam: `customerId` is an INT here (SQL `customer_id` is int). Callers
 * resolve any ObjectId string → int customer at this boundary.
 */
import { isMysqlModule } from "../../config/migration";
import { commerceSubscriptionRepository as repo } from "./commerce-subscription.repository";
import { toSubscriptionDto } from "./commerce-subscription.transformer";
import type { SubscriptionDto } from "./commerce-subscription.types";

export const SUBSCRIPTION_MODULE = "commerce-subscription";

/** Whether the subscription read-path is served from MySQL. */
export const isSubscriptionMysql = (): boolean => isMysqlModule(SUBSCRIPTION_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseSubscriptionId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── entitlement checks (the access gates) ───────────────────────────────────

/**
 * Does this customer hold an ACTIVE, unexpired COURSE entitlement?
 * Mirrors `findOne({customerId, courseId, status:true, endAt:{$gt:now}})`.
 */
export const hasActiveCourseSubscription = async (
  customerId: number,
  courseId: number,
  now: Date = new Date()
): Promise<boolean> => {
  const row = await repo.findActiveCourseSub(customerId, courseId, now);
  return row !== null;
};

/** Does this customer hold an ACTIVE, unexpired PACKAGE entitlement? */
export const hasActivePackageSubscription = async (
  customerId: number,
  packageId: number,
  now: Date = new Date()
): Promise<boolean> => {
  const row = await repo.findActivePackageSub(customerId, packageId, now);
  return row !== null;
};

/** The active course entitlement row (e.g. for days-left), or null. */
export const getActiveCourseSubscription = async (
  customerId: number,
  courseId: number,
  now: Date = new Date()
): Promise<SubscriptionDto | null> => {
  const row = await repo.findActiveCourseSub(customerId, courseId, now);
  return row ? toSubscriptionDto(row) : null;
};

/** The active package entitlement row, or null. */
export const getActivePackageSubscription = async (
  customerId: number,
  packageId: number,
  now: Date = new Date()
): Promise<SubscriptionDto | null> => {
  const row = await repo.findActivePackageSub(customerId, packageId, now);
  return row ? toSubscriptionDto(row) : null;
};

// ── single / listings ───────────────────────────────────────────────────────

export const findSubscriptionById = async (id: number): Promise<SubscriptionDto | null> => {
  const row = await repo.findById(id);
  return row ? toSubscriptionDto(row) : null;
};

/** All subscriptions for a customer, newest first. */
export const listSubscriptionsByCustomer = async (
  customerId: number
): Promise<SubscriptionDto[]> => {
  const rows = await repo.listByCustomer(customerId);
  return rows.map(toSubscriptionDto);
};

/** Active (status + unexpired) subscriptions for a customer, newest first. */
export const listActiveSubscriptionsByCustomer = async (
  customerId: number,
  now: Date = new Date()
): Promise<SubscriptionDto[]> => {
  const rows = await repo.listActiveByCustomer(customerId, now);
  return rows.map(toSubscriptionDto);
};

/**
 * Active (incl. lifetime) subscriptions for a customer matching any of the
 * given courses or plans — for computing per-course purchase state in listings.
 * Returns minimal rows: `{courseId, planId, endAt}` (ids as numbers, the int
 * id-space). Empty input short-circuits to `[]`.
 */
export const listActiveForCoursesOrPlans = async (
  customerId: number,
  courseIds: number[],
  planIds: number[],
  now: Date = new Date()
): Promise<Array<{ courseId: number | null; planId: number | null; endAt: Date | null }>> => {
  if (!courseIds.length && !planIds.length) return [];
  return repo.listActiveForCoursesOrPlans(customerId, courseIds, planIds, now);
};

// ── active-owner counts ──────────────────────────────────────────────────────

/** Count active owners of a package (SQL `package_id` — the actual package). */
export const countActiveByPackage = async (
  packageId: number,
  now: Date = new Date()
): Promise<number> => repo.countActiveByPackage(packageId, now);

/** Count active owners of a course. */
export const countActiveByCourse = async (
  courseId: number,
  now: Date = new Date()
): Promise<number> => repo.countActiveByCourse(courseId, now);
