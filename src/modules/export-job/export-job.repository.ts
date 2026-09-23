import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

// Prisma-only persistence for async export jobs (ws_export_job). Business logic +
// the actual file generation live in export-job.service.ts.
export const exportJobRepository = {
  create: (data: Prisma.ExportJobUncheckedCreateInput) => prisma.exportJob.create({ data }),
  findByRef: (jobRef: string) => prisma.exportJob.findUnique({ where: { jobRef } }),
  update: (id: number, data: Prisma.ExportJobUncheckedUpdateInput) => prisma.exportJob.update({ where: { id }, data }),
  // Boot rehydrate: jobs a crashed worker left mid-flight (processing) get requeued.
  stuckProcessing: () => prisma.exportJob.findMany({ where: { status: "processing" } }),
};
