// Shared promoter-subscription helpers.
//
// Promoter commission/sales now span FOUR subscription collections:
//   - ws_package_course_subscriptions  (course + package)   amount = paidAmount
//   - ws_ebook_subscriptions           (ebook)              amount = price
//   - ws_test_series_subscriptions     (test series)        amount = price
//   - ws_live_course_subscriptions     (live course)        amount = paidAmount
//
// These have different field names for the charged amount and different entity
// refs, so every promoter aggregation must union them into one NORMALISED shape
// before grouping. This module is the single source of that normalisation so the
// dashboard / overview / report / promocode-usage endpoints all agree.

import mongoose from "mongoose";

export const PROMOTER_SUB_COLLECTIONS = {
  packageCourse: "ws_package_course_subscriptions",
  ebook: "ws_ebook_subscriptions",
  testSeries: "ws_test_series_subscriptions",
  liveCourse: "ws_live_course_subscriptions",
} as const;

export type PromoterProductType = keyof typeof PROMOTER_SUB_COLLECTIONS;

// $project stage that maps a raw subscription doc to the common shape. `amount`
// is the charged amount (paidAmount for package/live, price for ebook/test),
// `commission` prefers the locked-in promoterCommission and falls back to
// amount×promoterPercentage for legacy rows.
function normaliseProject(amountField: "paidAmount" | "price", productType: PromoterProductType) {
  return {
    $project: {
      promoterId: 1,
      promocodeId: 1,
      customerId: 1,
      createdAt: 1,
      status: 1,
      endAt: 1,
      productType: { $literal: productType },
      amount: { $ifNull: [`$${amountField}`, 0] },
      commission: {
        $ifNull: [
          "$promoterCommission",
          {
            $multiply: [
              { $ifNull: [`$${amountField}`, 0] },
              { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
            ],
          },
        ],
      },
    },
  };
}

// Build the leading stages of an aggregation over ALL four collections,
// normalised to the common shape. Run this against PackageCourseSubscription;
// it projects that collection then $unionWith the other three (each normalised).
// `match` is applied to EACH collection BEFORE projection (so indexes are used).
export function unionAllPromoterSubsStages(match: Record<string, unknown>) {
  const mkUnion = (coll: string, amountField: "paidAmount" | "price", productType: PromoterProductType) => ({
    $unionWith: {
      coll,
      pipeline: [{ $match: match }, normaliseProject(amountField, productType)],
    },
  });

  return [
    { $match: match },
    normaliseProject("paidAmount", "packageCourse"),
    mkUnion(PROMOTER_SUB_COLLECTIONS.ebook, "price", "ebook"),
    mkUnion(PROMOTER_SUB_COLLECTIONS.testSeries, "price", "testSeries"),
    mkUnion(PROMOTER_SUB_COLLECTIONS.liveCourse, "paidAmount", "liveCourse"),
  ];
}

// Build the promoter-scope match used by every endpoint. promoterId undefined =>
// the unscoped "all promoters" view (still excludes non-promoter rows).
export function promoterScopeMatch(
  promoterId: string | undefined,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const m: Record<string, unknown> = {
    promoterId: promoterId
      ? mongoose.Types.ObjectId.createFromHexString(promoterId)
      : { $ne: null },
    ...(extra ?? {}),
  };
  return m;
}
