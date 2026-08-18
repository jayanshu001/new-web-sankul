import { prisma } from "../../config/prisma";

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
   */
  findPlanLink: (promocodeId: number, planId: number) =>
    prisma.promotedPackageCourseEbook.findFirst({
      where: { promocodeId, planId },
      include: { packageCourseEbookPrice: true },
    }),

  /** The purchased plan on its own (referral snapshots have no link row). */
  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({ where: { id: planId } }),

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
