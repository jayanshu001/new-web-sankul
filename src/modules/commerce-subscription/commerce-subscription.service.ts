// Package/course subscriptions: entitlement checks, lookups and counts.
import { commerceSubscriptionRepository as repo } from "./commerce-subscription.repository";
import { toSubscriptionDto } from "./commerce-subscription.transformer";
import type { SubscriptionDto } from "./commerce-subscription.types";
import { parsePositiveInt } from "../../utils/parseId";

export const parseSubscriptionId = parsePositiveInt;

export const hasActivePackageSubscription = async (
  customerId: number,
  packageId: number,
  now: Date = new Date()
): Promise<boolean> => {
  const row = await repo.findActivePackageSub(customerId, packageId, now);
  return row !== null;
};

export const getActivePackageSubscription = async (
  customerId: number,
  packageId: number,
  now: Date = new Date()
): Promise<SubscriptionDto | null> => {
  const row = await repo.findActivePackageSub(customerId, packageId, now);
  return row ? toSubscriptionDto(row) : null;
};

/**
 * `packageId → endAt` for every active package subscription, in one query; use
 * on listings instead of a per-row lookup. Presence = `isPurchased`; a `null`
 * value is an active row with no expiry. A null customer yields an empty Map.
 */
export const getActivePackageSubMap = async (
  customerId: number | null,
  packageIds: number[],
  now: Date = new Date()
): Promise<Map<number, Date | null>> => {
  const map = new Map<number, Date | null>();
  if (customerId == null || !packageIds.length) return map;
  const rows = await repo.findActivePackageSubsForPackages(customerId, packageIds, now);
  // Rows arrive endAt ASC, so the latest-expiring subscription wins.
  for (const r of rows) {
    if (r.packageId != null) map.set(r.packageId, r.endAt ?? null);
  }
  return map;
};

export const findSubscriptionById = async (id: number): Promise<SubscriptionDto | null> => {
  const row = await repo.findById(id);
  return row ? toSubscriptionDto(row) : null;
};

export const listActiveSubscriptionsByCustomer = async (
  customerId: number,
  now: Date = new Date()
): Promise<SubscriptionDto[]> => {
  const rows = await repo.listActiveByCustomer(customerId, now);
  return rows.map(toSubscriptionDto);
};

/** Active (incl. lifetime) subscriptions matching any of the given courses or plans. */
export const listActiveForCoursesOrPlans = async (
  customerId: number,
  courseIds: number[],
  planIds: number[],
  now: Date = new Date()
): Promise<Array<{ courseId: number | null; planId: number | null; endAt: Date | null }>> => {
  if (!courseIds.length && !planIds.length) return [];
  return repo.listActiveForCoursesOrPlans(customerId, courseIds, planIds, now);
};

/** Returns null when the id doesn't exist. */
export const updateSubscriptionEndAt = async (
  id: number,
  endAt: Date
): Promise<SubscriptionDto | null> => {
  const existing = await repo.findById(id);
  if (!existing) return null;
  const row = await repo.updateEndAt(id, endAt);
  return toSubscriptionDto(row);
};

export const countActiveByPackage = async (
  packageId: number,
  now: Date = new Date()
): Promise<number> => repo.countActiveByPackage(packageId, now);

export const countActiveByCourse = async (
  courseId: number,
  now: Date = new Date()
): Promise<number> => repo.countActiveByCourse(courseId, now);
