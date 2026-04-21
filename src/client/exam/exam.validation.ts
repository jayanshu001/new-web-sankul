import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id.");

export const saveAnswersSchema = z.object({
  examId: objectIdSchema,
  timing: z.string().min(1).max(20),
  test: z
    .array(
      z.object({
        questionId: objectIdSchema,
        answerId: objectIdSchema,
      })
    )
    .min(1),
  ratting: z.string().max(20).optional(),
});

export const rateResultSchema = z.object({
  ratting: z.string().min(1).max(20),
});
