import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

// Populate the parent state (Mongo `stateId` populated shape) for city DTOs.
const stateInclude = { State: { select: { id: true, name: true, state_code: true } } } as const;

// Shared WHERE for the admin city list + count (status/state filters + name search).
const adminCityWhere = (opts?: { status?: boolean; stateId?: number; search?: string }) => ({
  ...(opts?.status === undefined ? {} : { status: opts.status }),
  ...(opts?.stateId ? { state: opts.stateId } : {}),
  ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
});

/** Prisma persistence for the offline-city MySQL branch (ws_offline_city). */
export const offlineCityRepository = {
  /** Active cities, by manual `order` then name — mirrors Mongo `{status:true}` sort `{order:1}`. */
  listActive: (opts?: { search?: string; stateId?: number }) =>
    prisma.offlineCity.findMany({
      where: {
        status: true,
        ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
        ...(opts?.stateId ? { state: opts.stateId } : {}),
      },
      include: stateInclude,
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),

  /** Single city by id (cart `cityId` → name resolution + center listing). */
  findById: (id: number) => prisma.offlineCity.findUnique({ where: { id }, include: stateInclude }),

  /** Name-only fetch for the cart shipping resolution. */
  findNameById: (id: number) =>
    prisma.offlineCity.findUnique({ where: { id }, select: { id: true, name: true } }),

  // ── admin (Wave 8) ──────────────────────────────────────────────────────────
  /** Admin list: optional status + state filter + name search (includes inactive),
   *  newest first, paginated when skip/take are provided. */
  listAll: (opts?: { status?: boolean; stateId?: number; search?: string; skip?: number; take?: number }) =>
    prisma.offlineCity.findMany({
      where: adminCityWhere(opts),
      include: stateInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: opts?.skip,
      take: opts?.take,
    }),

  /** Total admin cities matching the same filters (pagination count). */
  countAll: (opts?: { status?: boolean; stateId?: number; search?: string }) =>
    prisma.offlineCity.count({ where: adminCityWhere(opts) }),

  create: (data: { name: string; image: string; order: number; status: boolean; state?: number | null }) => {
    const now = new Date();
    return prisma.offlineCity.create({ data: { ...data, createdAt: now, updatedAt: now }, include: stateInclude });
  },

  update: (id: number, data: Record<string, unknown>) =>
    prisma.offlineCity.update({ where: { id }, data: { ...data, updatedAt: new Date() }, include: stateInclude }),

  remove: (id: number) => prisma.offlineCity.delete({ where: { id } }),

  countCenters: (cityId: number) => prisma.offlineCenter.count({ where: { cityId } }),
};
