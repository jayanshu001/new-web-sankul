import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the commerce · promoter READ branch
 * (`ws_promoter`, Phase 3a — READ-ONLY, flag OFF).
 *
 * The promocode owner master. "Active" promoter = `status = true AND
 * is_delete = false` (the Mongo `{status:1, isDelete:1}` index intent). Reads
 * never select `password` — the transformer excludes it.
 */
export const commercePromoterRepository = {
  /** Single promoter by id. */
  findById: (id: number) =>
    prisma.promoter.findUnique({ where: { id } }),

  /** Single ACTIVE (status + not-deleted) promoter by id. */
  findActiveById: (id: number) =>
    prisma.promoter.findFirst({ where: { id, status: true, is_delete: false } }),

  /** Promoters by ids (for hydrating promocode owners in bulk). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.promoter.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
        })
      : Promise.resolve([]),

  /** Active promoters, ordered by name then id. Optional name/email search. */
  listActive: (opts?: { search?: string }) =>
    prisma.promoter.findMany({
      where: {
        status: true,
        is_delete: false,
        ...(opts?.search
          ? {
              OR: [
                { full_name: { contains: opts.search } },
                { email: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ full_name: "asc" }, { id: "asc" }],
    }),
};
