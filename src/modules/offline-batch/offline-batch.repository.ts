import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the offline · batch/center READ branch (flag OFF).
 * Neither `ws_offline_center` nor `ws_offline_batch` has a `status` column, so
 * there is NO status filter — all rows are active (the DTO synthesizes true).
 */
export const offlineBatchRepository = {
  // ── centers ────────────────────────────────────────────────────────────────
  /** Single center by id, with its city. */
  findCenterById: (id: number) =>
    prisma.offlineCenter.findUnique({ where: { id }, include: { city: true } }),

  /** Centers, optional city filter + name search, with city. Newest first. */
  listCenters: (opts?: { cityId?: number; search?: string }) =>
    prisma.offlineCenter.findMany({
      where: {
        ...(opts?.cityId != null ? { cityId: opts.cityId } : {}),
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      include: { city: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

  /** Centers for a set of cities (dashboard nesting). */
  listCentersByCities: (cityIds: number[]) =>
    cityIds.length
      ? prisma.offlineCenter.findMany({
          where: { cityId: { in: cityIds } },
          orderBy: { id: "asc" },
        })
      : Promise.resolve([]),

  // ── batches ──────────────────────────────────────────────────────────────
  /** Single batch by id, with center → city. */
  findBatchById: (id: number) =>
    prisma.offlineBatch.findUnique({
      where: { id },
      include: { center: { include: { city: true } } },
    }),

  /** Batches with optional center/name/upcoming filters, with center → city. */
  listBatches: (opts?: { centerId?: number; centerIds?: number[]; search?: string; upcomingAfter?: Date }) =>
    prisma.offlineBatch.findMany({
      where: {
        ...(opts?.centerId != null ? { centerId: opts.centerId } : {}),
        ...(opts?.centerIds ? { centerId: { in: opts.centerIds } } : {}),
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
        ...(opts?.upcomingAfter ? { startAt: { gt: opts.upcomingAfter } } : {}),
      },
      include: { center: { include: { city: true } } },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }),

  /** Batches for a set of centers (dashboard / center-detail nesting). */
  listBatchesByCenters: (centerIds: number[]) =>
    centerIds.length
      ? prisma.offlineBatch.findMany({
          where: { centerId: { in: centerIds } },
          orderBy: [{ startAt: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),

  /** Active batches starting after `now`, soonest first (dashboard upcoming). */
  listUpcoming: (now: Date, take: number) =>
    prisma.offlineBatch.findMany({
      where: { startAt: { gt: now } },
      include: { center: { include: { city: true } } },
      orderBy: { startAt: "asc" },
      take,
    }),
};
