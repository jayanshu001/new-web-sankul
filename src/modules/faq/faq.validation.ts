// FAQs: Zod request schemas.
import { z } from "zod";
import { FAQ_TYPES } from "./faq.types";

/**
 * The admin UI sends the category slug as `typeId` (matching the response's
 * `typeId._id`); the column is `type`. Alias it before validation.
 */
const aliasTypeId = (input: unknown) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    if (o.type === undefined && o.typeId !== undefined) return { ...o, type: o.typeId };
  }
  return input;
};

export const faqCreateSchemaMysql = z.preprocess(
  aliasTypeId,
  z.object({
    type: z.enum(FAQ_TYPES),
    question: z.string().min(1).max(1000),
    answer: z.string().min(1),
    isExpand: z.boolean().optional().default(false),
  })
);

export const faqUpdateSchemaMysql = z.preprocess(
  aliasTypeId,
  z
    .object({
      type: z.enum(FAQ_TYPES),
      question: z.string().min(1).max(1000),
      answer: z.string().min(1),
      isExpand: z.boolean().optional().default(false),
    })
    .partial()
);
