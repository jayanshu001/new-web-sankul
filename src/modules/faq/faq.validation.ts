import { z } from "zod";
import { FAQ_TYPES } from "./faq.types";

/**
 * The admin UI sends the FAQ category as `typeId` (the slug "general"/"referral",
 * matching the response's `typeId._id`), but MySQL `ws_faq` stores it in the
 * `type` enum column. Copy the `typeId` alias onto `type` before validation so
 * the inner object schema (and its output types) stay unchanged.
 */
const aliasTypeId = (input: unknown) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    if (o.type === undefined && o.typeId !== undefined) return { ...o, type: o.typeId };
  }
  return input;
};

/** MySQL `ws_faq` — uses `type` enum, not Mongo ObjectId `typeId`. */
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
