import { z } from "zod";
import { JOB_PRODUCT_TYPES, JOB_SUGGESTED_PLACEMENTS } from "./suggested-product.types";

const zBool = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

export const suggestedProductCreateSchema = z.object({
  placementType: z.enum(JOB_SUGGESTED_PLACEMENTS),
  postId: z.coerce.bigint().optional(),
  productType: z.enum(JOB_PRODUCT_TYPES),
  productId: z.coerce.bigint(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: zBool.optional(),
});

export const suggestedProductUpdateSchema = suggestedProductCreateSchema.partial();
