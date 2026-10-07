// Admin plans: Zod request schemas.
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

// Linkage (courseId/packageId/ebookId) is optional on update; the exactly-one rule
// applies only when at least one is sent (re-linking). The controller nulls the
// other two when linkage is supplied.
export const updatePlanSchema = z
  .object({
    name: z.string().max(255).optional(),
    courseId: z.string().nullable().optional(),
    packageId: z.string().nullable().optional(),
    ebookId: z.string().nullable().optional(),
    duration: z.number().int().positive().optional(),
    price: z.number().nonnegative().optional(),
    withMaterial: z.boolean().optional(),
    materialPrice: z.number().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    status: z.boolean().optional(),
  })
  .refine(
    (d) => {
      const present =
        d.courseId !== undefined || d.packageId !== undefined || d.ebookId !== undefined;
      if (!present) return true; // linkage not being changed — skip the rule
      const refs = [d.courseId, d.packageId, d.ebookId].filter(Boolean);
      return refs.length === 1;
    },
    { message: "Exactly one of courseId, packageId, ebookId must be set when re-linking." }
  );

export const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.boolean(),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
