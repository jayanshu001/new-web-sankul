import { prisma } from "../../config/prisma";
import type { TermsCreateInput, TermsUpdateInput } from "./terms.types";
import { toPrismaTermsCreate, toPrismaTermsUpdate } from "./terms.transformer";

export const termsRepository = {
  /** Admin list (all). Optional `activeOnly` + `module` filter for client reads. */
  findMany: (opts?: { activeOnly?: boolean; module?: string }) =>
    prisma.termsAndConditions.findMany({
      where: {
        ...(opts?.activeOnly ? { status: true } : {}),
        ...(opts?.module ? { module: opts.module } : {}),
      },
      orderBy: { id: "asc" },
    }),

  /** Client single-module read: first active row for that module. */
  findActiveByModule: (module: string) =>
    prisma.termsAndConditions.findFirst({ where: { module, status: true } }),

  findById: (id: number) =>
    prisma.termsAndConditions.findUnique({ where: { id } }),

  create: (input: TermsCreateInput) =>
    prisma.termsAndConditions.create({ data: toPrismaTermsCreate(input) }),

  update: (id: number, input: TermsUpdateInput) =>
    prisma.termsAndConditions.update({
      where: { id },
      data: toPrismaTermsUpdate(input),
    }),

  delete: (id: number) => prisma.termsAndConditions.delete({ where: { id } }),
};
