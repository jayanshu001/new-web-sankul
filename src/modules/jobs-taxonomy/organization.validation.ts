import { z } from "zod";

export const organizationCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().max(255).optional(),
  logoUrl: z.string().max(1000).optional(),
  logoAlt: z.string().max(255).optional(),
});

export const organizationUpdateSchema = organizationCreateSchema.partial();
