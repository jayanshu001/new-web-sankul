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

  // ── admin writes (Wave 8) ──────────────────────────────────────────────────
  cityExists: (id: number) =>
    prisma.offlineCity.findUnique({ where: { id }, select: { id: true } }),

  createCenter: (data: {
    name: string; image: any; address: string; latitude: number; longitude: number;
    phone: bigint; cityId: number;
  }) => {
    const now = new Date();
    return prisma.offlineCenter.create({
      data: { ...data, createdAt: now, updatedAt: now },
      include: { city: true },
    });
  },

  updateCenter: (id: number, data: Record<string, unknown>) =>
    prisma.offlineCenter.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      include: { city: true },
    }),

  deleteCenter: (id: number) => prisma.offlineCenter.delete({ where: { id } }),

  countBatchesInCenter: (centerId: number) =>
    prisma.offlineBatch.count({ where: { centerId } }),

  createBatch: (data: {
    name: string; image: string; discription: string; startAt: Date; duration: string; centerId: number;
  }) => {
    const now = new Date();
    return prisma.offlineBatch.create({
      data: { ...data, createdAt: now, updatedAt: now },
      include: { center: { include: { city: true } } },
    });
  },

  updateBatch: (id: number, data: Record<string, unknown>) =>
    prisma.offlineBatch.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      include: { center: { include: { city: true } } },
    }),

  deleteBatch: (id: number) => prisma.offlineBatch.delete({ where: { id } }),

  deleteEnquiriesInBatch: (batchId: number) =>
    prisma.offlineEnquiry.deleteMany({ where: { batchId } }),

  // ── offline banner (OfflineBannerSlider) ────────────────────────────────────
  listBanners: () => prisma.offlineBannerSlider.findMany({ orderBy: { orderBy: "asc" } }),
  findBannerById: (id: number) => prisma.offlineBannerSlider.findUnique({ where: { id }, select: { id: true } }),
  createBanner: (data: { image: string; key: string | null; keyId: number | null; orderBy: number }) => {
    const now = new Date();
    return prisma.offlineBannerSlider.create({ data: { ...data, createdAt: now, updatedAt: now } });
  },
  updateBanner: (id: number, data: Record<string, unknown>) =>
    prisma.offlineBannerSlider.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  deleteBanner: (id: number) => prisma.offlineBannerSlider.delete({ where: { id } }),
  reorderBanner: (id: number, orderBy: number) =>
    prisma.offlineBannerSlider.updateMany({ where: { id }, data: { orderBy, updatedAt: new Date() } }),
};
