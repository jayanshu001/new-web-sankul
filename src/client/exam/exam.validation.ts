import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id.");

export const saveAnswersSchema = z.object({
  examId: objectIdSchema,
  timing: z.string().regex(/^\d{1,3}:\d{2}(:\d{2})?$/, "Timing must be in MM:SS or HH:MM:SS format."),
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
