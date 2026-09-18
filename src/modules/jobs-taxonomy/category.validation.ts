import { z } from "zod";

const zBool = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());
const zNullableBigInt = z.preprocess((v) => (v === "" ? null : v), z.coerce.bigint().nullable().optional());

export const categoryCreateSchema = z.object({
  slug: z.string().max(100).optional(),
  label: z.string().min(1).max(255),
  organizationId: zNullableBigInt,
  sortOrder: z.coerce.number().int().optional(),
  imageMediaId: z.coerce.bigint().optional(),
  showOnHome: zBool.optional(),
  isActive: zBool.optional(),
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

export const categoryReorderSchema = z.object({
  orders: z.array(z.object({ id: z.string(), order: z.coerce.number().int() })),
});
