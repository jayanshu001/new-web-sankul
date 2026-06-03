import { prisma } from "../../config/prisma";
import type { AppUpdateUpsertInput } from "./app-update.types";
import { toPrismaAppUpdateWrite } from "./app-update.transformer";

const SINGLETON_ID = 1;

export const appUpdateRepository = {
  findSingleton: () =>
    prisma.appUpdate.findUnique({ where: { id: SINGLETON_ID } }),

  upsertSingleton: (input: AppUpdateUpsertInput) => {
    const data = toPrismaAppUpdateWrite(input);
    return prisma.appUpdate.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
  },
};
