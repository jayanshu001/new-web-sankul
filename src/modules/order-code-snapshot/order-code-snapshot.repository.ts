// Order code snapshot: Prisma lookups for promocodes, referrers and plans.
import { prisma } from "../../config/prisma";
import type { SnapshotPlanKind } from "./order-code-snapshot.types";

/** Read on the checkout hot path: each call is a single indexed lookup. */
export const orderCodeSnapshotRepository = {
  findPromocode: (promocodeId: number) =>
    prisma.promocode.findUnique({
      where: { id: promocodeId },
      include: { promoter: true },
    }),

  /**
   * The promocode→plan link for the purchased plan, with the plan expanded; null for
   * a global-discount promocode with no link rows.
   *
   * `planKind` is required in the filter: the plan tables share an id space and
   * `pcb_price_id` is declared as an FK to ws_package_course_ebook_price for every
   * kind, so matching on (promocodeId, planId) alone can expand an unrelated plan and
   * pay out its promoterPercentage. Only the price kind may use the relation.
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

  /** Referral snapshots have no link row. */
  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({ where: { id: planId } }),

  /** ws_live_course_plan (a different table). */
  findLivePlan: (planId: number) =>
    prisma.liveCoursePlan.findUnique({ where: { id: planId } }),

  /** ws_test_series_price (a third table). */
  findTestSeriesPlan: (planId: number) =>
    prisma.testSeriesPrice.findUnique({ where: { id: planId } }),

  /** Same single-row lookup `resolveReferralCode` prices with, so the snapshot matches the applied program. */
  findReferralProgram: () =>
    prisma.refferalProgram.findFirst({ where: { name: "student", status: true } }),

  findReferrer: (referrerId: number) =>
    prisma.customer.findUnique({
      where: { id: referrerId },
      select: { id: true, fullName: true, phoneNumber: true, referralCode: true },
    }),
};
