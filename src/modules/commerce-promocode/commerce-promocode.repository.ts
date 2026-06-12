import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the commerce · promocode READ branch
 * (`ws_promocode` + `ws_promoted_package_course_ebook`, Phase 3a — READ-ONLY,
 * flag OFF).
 *
 * SQL-faithful reads only — see types.ts for the appliesTo model divergence.
 * "Valid" promocode = `status = true AND promo_start_at < now < promo_expire_at`
 * (the Mongo listPromocodes/applyPromocode predicate), `type = 'public'` for
 * public listings. Promoted-plan rows are included on single-promocode reads.
 */
export const commercePromocodeRepository = {
  /** Single promocode by id, with its promoted plans. */
  findById: (id: number) =>
    prisma.promocode.findUnique({
      where: { id },
      include: { promotedPackageCourseEbook: true },
    }),

  /**
   * Single VALID promocode by its code (case-insensitive in the Mongo path via
   * uppercasing; the SQL collation is case-insensitive by default). Includes
   * promoted plans. Mirrors `findOne({promocode, status:true, start<now<expire})`.
   */
  findValidByCode: (code: string, now: Date) =>
    prisma.promocode.findFirst({
      where: {
        promocode: code,
        status: true,
        promo_start_at: { lt: now },
        promo_expire_at: { gt: now },
      },
      include: { promotedPackageCourseEbook: true },
    }),

  /** Active public promocodes within their window, soonest-to-expire first. */
  listActivePublic: (now: Date, opts?: { skip?: number; take?: number }) =>
    prisma.promocode.findMany({
      where: {
        status: true,
        type: "public",
        promo_start_at: { lt: now },
        promo_expire_at: { gt: now },
      },
      orderBy: [{ promo_expire_at: "asc" }, { id: "asc" }],
      ...(opts?.skip != null ? { skip: opts.skip } : {}),
      ...(opts?.take != null ? { take: opts.take } : {}),
    }),

  /** Count of active public promocodes within their window (pagination total). */
  countActivePublic: (now: Date) =>
    prisma.promocode.count({
      where: {
        status: true,
        type: "public",
        promo_start_at: { lt: now },
        promo_expire_at: { gt: now },
      },
    }),

  /** Promoted-plan rows for a promocode. */
  listPromotedPlans: (promocodeId: number) =>
    prisma.promotedPackageCourseEbook.findMany({
      where: { promocodeId },
      orderBy: { id: "asc" },
    }),
};
