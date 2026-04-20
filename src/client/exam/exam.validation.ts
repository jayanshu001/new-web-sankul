import { z } from "zod";

export const autosaveAnswerSchema = z.object({
  questionId: z.string().min(1),
  selectedOptionIds: z.array(z.string()).default([]),
});

export const autosaveAnswersSchema = z.object({
  answers: z.array(autosaveAnswerSchema).min(1),
});

export const submitAttemptSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        selectedOptionIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
});
