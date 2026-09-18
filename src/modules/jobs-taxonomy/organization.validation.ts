import { z } from "zod";

export const organizationCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().max(255).optional(),
  logoMediaId: z.coerce.bigint().optional(),
});

export const organizationUpdateSchema = organizationCreateSchema.partial();
