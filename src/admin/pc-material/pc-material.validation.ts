import { z } from "zod";

// Package Course Material is a single-field master: just a `title`. The admin
// "Add Material" form (see Package Course Material Page) submits one text box.
export const createPcMaterialSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
});

export const updatePcMaterialSchema = createPcMaterialSchema.partial();
