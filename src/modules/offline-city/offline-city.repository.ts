import { prisma } from "../../config/prisma";

/** Prisma persistence for the offline-city MySQL branch (ws_offline_city). */
export const offlineCityRepository = {
  /** Active cities, by manual `order` then name — mirrors Mongo `{status:true}` sort `{order:1}`. */
  listActive: (opts?: { search?: string }) =>
    prisma.offlineCity.findMany({
      where: {
        status: true,
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),

  /** Single city by id (cart `cityId` → name resolution + center listing). */
  findById: (id: number) => prisma.offlineCity.findUnique({ where: { id } }),

  /** Name-only fetch for the cart shipping resolution. */
  findNameById: (id: number) =>
    prisma.offlineCity.findUnique({ where: { id }, select: { id: true, name: true } }),
};
