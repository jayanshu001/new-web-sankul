import type { FAQ } from "@prisma/client";
import type { FaqCategory, FaqDto, FaqCreateInput, FaqUpdateInput } from "./faq.types";
import { FAQ_TYPE_LABELS } from "./faq.types";

export const toFaqTypeDto = (type: FaqCategory) => ({
  _id: type,
  title: FAQ_TYPE_LABELS[type] ?? type,
});

export const toFaqDto = (row: FAQ): FaqDto => {
  const category = row.type as FaqCategory;
  return {
    _id: String(row.id),
    type: category,
    typeId: toFaqTypeDto(category),
    question: row.question,
    answer: row.answer,
    isExpand: row.is_expand,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
};

export const toPrismaFaqCreate = (input: FaqCreateInput) => ({
  type: input.type,
  question: input.question,
  answer: input.answer,
  is_expand: input.isExpand ?? false,
  created_at: new Date(),
  updated_at: new Date(),
});

export const toPrismaFaqUpdate = (input: FaqUpdateInput) => ({
  ...(input.type !== undefined ? { type: input.type } : {}),
  ...(input.question !== undefined ? { question: input.question } : {}),
  ...(input.answer !== undefined ? { answer: input.answer } : {}),
  ...(input.isExpand !== undefined ? { is_expand: input.isExpand } : {}),
  updated_at: new Date(),
});
