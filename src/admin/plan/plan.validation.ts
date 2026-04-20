import { z } from "zod";

export const createPlanSchema = z
  .object({
    name: z.string().max(255).optional(),
    courseId: z.string().nullable().optional(),
    packageId: z.string().nullable().optional(),
    ebookId: z.string().nullable().optional(),
    duration: z.number().int().positive(),
    price: z.number().nonnegative(),
    withMaterial: z.boolean().optional(),
    materialPrice: z.number().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    status: z.boolean().optional(),
  })
  .refine(
    (d) => {
      const refs = [d.courseId, d.packageId, d.ebookId].filter(Boolean);
      return refs.length === 1;
    },
    { message: "Exactly one of courseId, packageId, ebookId must be set." }
  );

export const updatePlanSchema = z.object({
  name: z.string().max(255).optional(),
  duration: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  withMaterial: z.boolean().optional(),
  materialPrice: z.number().nonnegative().optional(),
  isDefault: z.boolean().optional(),
  status: z.boolean().optional(),
});

export const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.boolean(),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
