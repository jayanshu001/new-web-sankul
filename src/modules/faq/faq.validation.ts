import { z } from "zod";
import { FAQ_TYPES } from "./faq.types";

/** MySQL `ws_faq` — uses `type` enum, not Mongo ObjectId `typeId`. */
export const faqCreateSchemaMysql = z.object({
  type: z.enum(FAQ_TYPES),
  question: z.string().min(1).max(1000),
  answer: z.string().min(1),
  isExpand: z.boolean().optional().default(false),
});

export const faqUpdateSchemaMysql = faqCreateSchemaMysql.partial();
