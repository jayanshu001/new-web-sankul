import { z } from "zod";

export const createTermSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  order: z.number().int().nonnegative().optional(),
  status: z.boolean().optional(),
});

export const updateTermSchema = createTermSchema.partial();

export const createFaqSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(5000),
  order: z.number().int().nonnegative().optional(),
  status: z.boolean().optional(),
});

export const updateFaqSchema = createFaqSchema.partial();
