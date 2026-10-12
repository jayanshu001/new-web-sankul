import { prisma } from "../../config/prisma";
import type { RankSuggestionInput } from "./rank-suggestion.types";

const toData = (input: RankSuggestionInput) => ({
  kind: input.kind,
  productType: input.productType ?? null,
  productId: input.productId ?? null,
  url: input.url ?? null,
  title: input.title ?? null,
  image: input.image ?? null,
  description: input.description ?? null,
  ctaLabel: input.ctaLabel ?? null,
  minMarks: input.minMarks ?? null,
  maxMarks: input.maxMarks ?? null,
  sortOrder: input.sortOrder ?? 0,
  isActive: input.isActive ?? true,
});

export const rankSuggestionRepository = {
  findExam: (examId: bigint) =>
    prisma.ocrExam.findUnique({ where: { id: examId }, select: { id: true, isActive: true } }),

  listForExam: (examId: bigint, activeOnly = false) =>
    prisma.ocrSuggestion.findMany({
      where: { examId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),

  findById: (id: bigint) => prisma.ocrSuggestion.findUnique({ where: { id } }),

  create: (examId: bigint, input: RankSuggestionInput) => {
    const now = new Date();
    return prisma.ocrSuggestion.create({
      data: { examId, ...toData(input), createdAt: now, updatedAt: now },
    });
  },

  update: (id: bigint, input: RankSuggestionInput) =>
    prisma.ocrSuggestion.update({
      where: { id },
      data: { ...toData(input), updatedAt: new Date() },
    }),

  delete: (id: bigint) => prisma.ocrSuggestion.delete({ where: { id } }),

  findRawScore: (examId: bigint, customerId: number) =>
    prisma.ocrScore.findUnique({
      where: { examId_customerId: { examId, customerId } },
      select: { rawScore: true },
    }),
};
