// Offline enquiries: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaPrefixSearch } from "../../utils/searchFilter";

export const offlineEnquiryRepository = {
  batchExists: async (batchId: number): Promise<boolean> =>
    (await prisma.offlineBatch.count({ where: { id: batchId } })) > 0,

  /** Same customer + batch + qualification within the day window. Never pass the anonymous 0 id. */
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

  /** customer_id stores 0 for anonymous (NOT NULL column). */
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

  /** `search` matches name OR email; mobile is BigInt and not text-searchable. */
  list: (opts: {
    batchId?: number; search?: string; from?: Date; to?: Date; skip: number; take: number;
  }) => {
    const where: any = {};
    if (opts.batchId != null) where.batchId = opts.batchId;
    const search = buildPrismaPrefixSearch(opts.search, ["name", "email"]);
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
