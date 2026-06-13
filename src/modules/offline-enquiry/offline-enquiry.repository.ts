import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the offline · enquiry WRITE branch (Phase 3b,
 * `ws_offline_enquiry`). Single-table lead-capture write. See types.ts for the
 * drift notes (bigint mobile, customer_id 0-sentinel, no remarks column).
 */
export const offlineEnquiryRepository = {
  /** Does this batch exist? (int id-space, mirrors the Mongo existence check.) */
  batchExists: async (batchId: number): Promise<boolean> =>
    (await prisma.offlineBatch.count({ where: { id: batchId } })) > 0,

  /** Insert an enquiry row. customer_id stores 0 for anonymous (NOT NULL col). */
  create: (input: {
    customerId: number;
    name: string;
    email: string;
    mobile: bigint;
    qualification: string;
    batchId: number;
  }) =>
    prisma.offlineEnquiry.create({
      data: {
        userId: input.customerId,
        name: input.name,
        email: input.email,
        mobile: input.mobile,
        qualification: input.qualification,
        batchId: input.batchId,
      },
    }),
};
