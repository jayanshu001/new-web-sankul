// Async exports: Prisma queries for export jobs.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

export const exportJobRepository = {
  create: (data: Prisma.ExportJobUncheckedCreateInput) => prisma.exportJob.create({ data }),
  findByRef: (jobRef: string) => prisma.exportJob.findUnique({ where: { jobRef } }),
  update: (id: number, data: Prisma.ExportJobUncheckedUpdateInput) => prisma.exportJob.update({ where: { id }, data }),
  // Boot rehydrate: jobs a crashed worker left in "processing".
  stuckProcessing: () => prisma.exportJob.findMany({ where: { status: "processing" } }),
};
