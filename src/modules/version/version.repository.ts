import { prisma } from "../../config/prisma";
import type { VersionUpsertInput } from "./version.types";

const SINGLETON_ID = 1;

export const versionRepository = {
  findSingleton: () =>
    prisma.version.findUnique({ where: { id: SINGLETON_ID } }),

  upsertSingleton: (input: VersionUpsertInput) =>
    prisma.version.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...input },
      update: input,
    }),
};
