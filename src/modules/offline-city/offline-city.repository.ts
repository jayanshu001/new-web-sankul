// Offline cities: Prisma queries.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch, buildPrismaPrefixSearch } from "../../utils/searchFilter";

const stateInclude = { State: { select: { id: true, name: true, state_code: true } } } as const;

const adminCityWhere = (opts?: { status?: boolean; stateId?: number; search?: string }) => ({
  ...(opts?.status === undefined ? {} : { status: opts.status }),
  ...(opts?.stateId ? { state: opts.stateId } : {}),
  ...(buildPrismaPrefixSearch(opts?.search, ["name"]) ?? {}),
});

export const offlineCityRepository = {
  /** Active cities, by manual `order` then creation time. */
  listActive: (opts?: { search?: string; stateId?: number }) =>
    prisma.offlineCity.findMany({
      where: {
        status: true,
        ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
        ...(opts?.stateId ? { state: opts.stateId } : {}),
      },
      include: stateInclude,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),

  findById: (id: number) => prisma.offlineCity.findUnique({ where: { id }, include: stateInclude }),

  findNameById: (id: number) =>
    prisma.offlineCity.findUnique({ where: { id }, select: { id: true, name: true } }),

  /** Admin list (includes inactive), newest first; paginated when skip/take are provided. */
  listAll: (opts?: { status?: boolean; stateId?: number; search?: string; skip?: number; take?: number }) =>
    prisma.offlineCity.findMany({
      where: adminCityWhere(opts),
      include: stateInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: opts?.skip,
      take: opts?.take,
    }),

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
