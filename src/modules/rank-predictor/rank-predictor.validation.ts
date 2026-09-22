import { z } from "zod";
import { normalizePaperSeries } from "./rank-predictor.scoring";
import {
  CASTE_CATEGORIES,
  GENDERS,
  MAX_PAPER_SERIES,
  MAX_TOTAL_QUESTIONS,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from "./rank-predictor.types";

const SERIES_LETTER = /^[A-Z]$/;
const QUESTION_NUMBER = /^\d+$/;

const positiveIntId = z.coerce.number().int().positive();

const paperSeriesSchema = z
  .array(z.string())
  .max(MAX_PAPER_SERIES)
  .transform(normalizePaperSeries)
  .refine((series) => series.every((letter) => SERIES_LETTER.test(letter)), {
    message: "Paper series must be single letters, e.g. A, B, C, D.",
  });

const seriesSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SERIES_LETTER, "Paper series must be a single letter, e.g. A.");

export const answerKeyMapSchema = z
  .record(z.string().regex(QUESTION_NUMBER), z.number().int().positive())
  .refine((keys) => Object.keys(keys).length > 0, { message: "The answer key is empty." });

export const examCreateSchema = z.object({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  totalQuestions: z.coerce.number().int().positive().max(MAX_TOTAL_QUESTIONS),
  category: z.string().trim().max(255).nullish(),
  examDate: z.coerce.date().nullish(),
  paperSeries: paperSeriesSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});

export const examUpdateSchema = examCreateSchema.partial();

export const examIdParamSchema = z.object({ examId: positiveIntId });

export const submissionIdParamSchema = z.object({
  examId: positiveIntId,
  submissionId: positiveIntId,
});

export const answerKeyUploadSchema = z.object({
  series: seriesSchema.nullish(),
  keys: z
    .union([z.string(), answerKeyMapSchema])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || typeof value !== "string") return value;
      try {
        return answerKeyMapSchema.parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "keys is not a valid answer key." });
        return z.NEVER;
      }
    }),
  marksCorrect: z.coerce.number().min(0).max(100).default(1),
  marksWrong: z.coerce.number().min(0).max(100).default(0),
});

export const submissionCreateSchema = z.object({ series: seriesSchema.nullish() });

export const correctionsSchema = z.object({
  corrections: z.record(z.string().regex(QUESTION_NUMBER), z.number().int().positive().nullable()),
});

export const leaderboardQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const examListQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isActive: z.coerce.boolean().optional(),
});

export const submissionStatusSchema = z.enum(
  SUBMISSION_STATUSES as unknown as [SubmissionStatus, ...SubmissionStatus[]]
);

export const submissionListQuerySchema = z.object({
  status: submissionStatusSchema.optional(),
  examId: positiveIntId.optional(),
  search: z.string().trim().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const leaderboardPrivacySchema = z.object({ showRealName: z.coerce.boolean() });

export const candidateProfileSchema = z.object({
  casteCategory: z.enum(CASTE_CATEGORIES),
  gender: z.enum(GENDERS),
  isExServiceman: z.union([
    z.boolean(),
    z.enum(["true", "false"]).transform((value) => value === "true"),
  ]),
});
