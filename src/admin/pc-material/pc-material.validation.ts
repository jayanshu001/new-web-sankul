import { z } from "zod";

export const createPcMaterialSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
});

export const updatePcMaterialSchema = createPcMaterialSchema.partial();
