// Terms and conditions: Zod request schemas.
import { z } from "zod";
import { TERMS_MODULES } from "./terms.types";

/** `module` must be a valid enum value or MySQL rejects the row (error 1265). */
export const termsCreateSchemaMysql = z.object({
  module: z.enum(TERMS_MODULES),
  terms: z.string().min(1),
  freeShippingMinimumOrderAmount: z.number().int().nonnegative().default(0),
  status: z.boolean().optional(),
});

export const termsUpdateSchemaMysql = termsCreateSchemaMysql.partial();
