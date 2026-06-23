import { prisma } from "../../config/prisma";

// Populate the parent state (Mongo `stateId` populated shape) for city DTOs.
const stateInclude = { State: { select: { id: true, name: true, state_code: true } } } as const;

/** Prisma persistence for the offline-city MySQL branch (ws_offline_city). */
export const offlineCityRepository = {
  /** Active cities, by manual `order` then name — mirrors Mongo `{status:true}` sort `{order:1}`. */
  listActive: (opts?: { search?: string; stateId?: number }) =>
    prisma.offlineCity.findMany({
      where: {
        status: true,
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
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
  /** Admin list: optional status + state filter (includes inactive), manual order. */
  listAll: (opts?: { status?: boolean; stateId?: number }) =>
    prisma.offlineCity.findMany({
      where: {
        ...(opts?.status === undefined ? {} : { status: opts.status }),
        ...(opts?.stateId ? { state: opts.stateId } : {}),
      },
      include: stateInclude,
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),

  create: (data: { name: string; image: string; order: number; status: boolean; state?: number | null }) => {
    const now = new Date();
    return prisma.offlineCity.create({ data: { ...data, createdAt: now, updatedAt: now }, include: stateInclude });
  },

  update: (id: number, data: Record<string, unknown>) =>
    prisma.offlineCity.update({ where: { id }, data: { ...data, updatedAt: new Date() }, include: stateInclude }),

  remove: (id: number) => prisma.offlineCity.delete({ where: { id } }),

  countCenters: (cityId: number) => prisma.offlineCenter.count({ where: { cityId } }),
};
