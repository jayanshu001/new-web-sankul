import { prisma } from "../../config/prisma";
import type { SnapshotPlanKind } from "./order-code-snapshot.types";

/**
 * Prisma reads backing the order code snapshot. Query-only — the shaping lives
 * in the transformer, the orchestration in the service.
 *
 * Everything here is read on the checkout hot path (create-order), so each call
 * is a single indexed lookup and the plan is fetched via the link's relation
 * rather than as a second round trip.
 */
export const orderCodeSnapshotRepository = {
  /** The promocode + its owning promoter (ws_promocode ⋈ ws_promoter). */
  findPromocode: (promocodeId: number) =>
    prisma.promocode.findUnique({
      where: { id: promocodeId },
      include: { promoter: true },
    }),

  /**
   * The promocode→plan link for the PURCHASED plan, with the plan expanded.
   * Null for a legacy "global discount" promocode that has no link rows.
   *
   * ⚠ `planKind` is REQUIRED in the filter, not decorative. ws_live_course_plan and
   * ws_package_course_ebook_price share an id space, and `pcb_price_id` is declared
   * as an FK to the latter for EVERY kind — so matching on (promocodeId, planId)
   * alone can return a "price" link when a live-course plan was purchased, and
   * `packageCourseEbookPrice` would then expand an unrelated plan whose
   * promoterPercentage gets paid out. Only the price kind may use the relation.
   */
  findPlanLink: (promocodeId: number, planId: number, planKind: SnapshotPlanKind) =>
    planKind === "price"
      ? prisma.promotedPackageCourseEbook.findFirst({
          where: { promocodeId, planId, planKind },
          include: { packageCourseEbookPrice: true },
        })
      : prisma.promotedPackageCourseEbook.findFirst({
          where: { promocodeId, planId, planKind },
        }),

  /** The purchased plan on its own (referral snapshots have no link row). */
  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({ where: { id: planId } }),

  /** The purchased LIVE-COURSE plan (ws_live_course_plan — a different table). */
  findLivePlan: (planId: number) =>
    prisma.liveCoursePlan.findUnique({ where: { id: planId } }),

  /** The purchased TEST-SERIES plan (ws_test_series_price — a third table). */
  findTestSeriesPlan: (planId: number) =>
    prisma.testSeriesPrice.findUnique({ where: { id: planId } }),

  /**
   * The active referral program. Keyed on name "student" — the same single-row
   * lookup `resolveReferralCode` uses to price the discount, so the snapshot can
   * never describe a different program than the one that was actually applied.
   */
  findReferralProgram: () =>
    prisma.refferalProgram.findFirst({ where: { name: "student", status: true } }),

  /** The referring customer whose code was redeemed. */
  findReferrer: (referrerId: number) =>
    prisma.customer.findUnique({
      where: { id: referrerId },
      select: { id: true, fullName: true, phoneNumber: true, referralCode: true },
    }),
};
