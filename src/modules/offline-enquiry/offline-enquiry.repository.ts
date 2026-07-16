import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Prisma persistence for the offline · enquiry WRITE branch (Phase 3b,
 * `ws_offline_enquiry`). Single-table lead-capture write. See types.ts for the
 * drift notes (bigint mobile, customer_id 0-sentinel, no remarks column).
 */
export const offlineEnquiryRepository = {
  /** Does this batch exist? (int id-space, mirrors the Mongo existence check.) */
  batchExists: async (batchId: number): Promise<boolean> =>
    (await prisma.offlineBatch.count({ where: { id: batchId } })) > 0,

  /**
   * Has this customer already submitted an enquiry for the same batch AND the
   * same qualification within the given day window? Backs the batch-enquiry
   * duplicate guard (same user + batch + qualification + same day). Anonymous
   * (customerId 0) is never matched — the caller must pass a real customer id.
   */
  existsSameDayForBatchQualification: async (opts: {
    customerId: number;
    batchId: number;
    qualification: string;
    dayStart: Date;
    dayEnd: Date;
  }): Promise<boolean> =>
    (await prisma.offlineEnquiry.count({
      where: {
        userId: opts.customerId,
        batchId: opts.batchId,
        qualification: opts.qualification,
        createdAt: { gte: opts.dayStart, lte: opts.dayEnd },
      },
    })) > 0,

  /**
   * Insert an enquiry row. customer_id stores 0 for anonymous (NOT NULL col).
   * `otherQualification` is optional (only the batch-enquiry "Register" form
   * sets it; maps to ws_offline_enquiry.other_qualification).
   */
  create: (input: {
    customerId: number;
    name: string;
    email: string;
    mobile: bigint;
    qualification: string;
    otherQualification?: string | null;
    batchId: number;
  }) =>
    prisma.offlineEnquiry.create({
      data: {
        userId: input.customerId,
        name: input.name,
        email: input.email,
        mobile: input.mobile,
        qualification: input.qualification,
        otherQualification: input.otherQualification ?? null,
        batchId: input.batchId,
      },
    }),

  // ── admin list / delete (Wave 8) ───────────────────────────────────────────
  /**
   * Paginated admin list with optional batch / name-email search / date range.
   * `search` matches name OR email (mobile is BigInt — not text-searchable here,
   * mirrors the practical effect of the Mongo regex on string fields).
   */
  list: (opts: {
    batchId?: number; search?: string; from?: Date; to?: Date; skip: number; take: number;
  }) => {
    const where: any = {};
    if (opts.batchId != null) where.batchId = opts.batchId;
    const search = buildPrismaSearch(opts.search, ["name", "email"]);
    if (search) where.AND = search.AND;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = opts.from;
      if (opts.to) where.createdAt.lte = opts.to;
    }
    return Promise.all([
      prisma.offlineEnquiry.findMany({
        where,
        include: { batch: { select: { id: true, name: true, startAt: true } } },
        orderBy: { createdAt: "desc" },
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.offlineEnquiry.count({ where }),
    ]);
  },

  findById: (id: number) => prisma.offlineEnquiry.findUnique({ where: { id }, select: { id: true } }),

  deleteById: (id: number) => prisma.offlineEnquiry.delete({ where: { id } }),
};
