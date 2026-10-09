import { z } from "zod";
import { normalizePaperSeries } from "./rank-predictor.scoring";
import {
  CANCELLED_QUESTION,
  CASTE_CATEGORIES,
  GENDERS,
  KEY_SOURCES,
  MAX_PAPER_SERIES,
  MAX_PAPER_SHIFTS,
  MAX_SYLLABUS_SUBJECTS,
  RANK_BY_VALUES,
  MAX_TOTAL_QUESTIONS,
  SUBMISSION_MODES,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from "./rank-predictor.types";

const SERIES_LETTER = /^[A-Z]$/;
const SHIFT_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const QUESTION_NUMBER = /^\d+$/;

const positiveIntId = z.coerce.number().int().positive();

const shiftKeySchema = z.string().trim().regex(SHIFT_KEY, "shift must look like 2026-09-17T13:00");

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

const optionSchema = z.number().int().positive();

/**
 * Several accepted options are stored sorted and de-duplicated, and a list of one
 * collapses to a plain number, so the same key is always stored the same way.
 */
const acceptedOptionsSchema = z
  .array(optionSchema)
  .min(1, "A question needs at least one accepted option.")
  .transform((options) => {
    const unique = [...new Set(options)].sort((a, b) => a - b);
    return unique.length === 1 ? unique[0] : unique;
  });

const answerKeyEntrySchema = z.union([
  optionSchema,
  acceptedOptionsSchema,
  z.literal(CANCELLED_QUESTION),
]);

export const answerKeyMapSchema = z
  .record(z.string().regex(QUESTION_NUMBER), answerKeyEntrySchema)
  .refine((keys) => Object.keys(keys).length > 0, { message: "The answer key is empty." })
  .refine((keys) => Object.values(keys).some((entry) => entry !== CANCELLED_QUESTION), {
    message: "Every question is cancelled, so there is nothing to score.",
  });

const syllabusSubjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    marks: z.coerce.number().positive().max(10000).optional(),
    section: z.string().trim().min(1).max(100).optional(),
    from_question: z.coerce.number().int().positive().optional(),
    to_question: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (subject) =>
      subject.from_question === undefined ||
      subject.to_question === undefined ||
      subject.from_question <= subject.to_question,
    { message: "A subject's first question cannot come after its last." }
  );

/** Subject names are the board keys, so two that differ only by case would collide. */
const syllabusSchema = z
  .array(syllabusSubjectSchema)
  .max(MAX_SYLLABUS_SUBJECTS)
  .refine(
    (subjects) =>
      new Set(subjects.map((subject) => subject.name.toLowerCase())).size === subjects.length,
    { message: "Each subject needs its own name." }
  );

/** Cancellations are stored sorted and de-duplicated, so the same list compares equal. */
const paperShiftSchema = z.object({
  key: shiftKeySchema,
  cancelled_questions: z
    .array(z.coerce.number().int().positive().max(MAX_TOTAL_QUESTIONS))
    .max(MAX_TOTAL_QUESTIONS)
    .default([])
    .transform((questions) => [...new Set(questions)].sort((a, b) => a - b)),
});

const paperShiftsSchema = z
  .array(paperShiftSchema)
  .max(MAX_PAPER_SHIFTS)
  .refine((shifts) => new Set(shifts.map((shift) => shift.key)).size === shifts.length, {
    message: "Each shift can be listed only once.",
  })
  .transform((shifts) => [...shifts].sort((a, b) => a.key.localeCompare(b.key)));

const rankBySchema = z
  .array(z.enum(RANK_BY_VALUES))
  .transform((values) => [...new Set(values)]);

const submissionModesSchema = z
  .array(z.enum(SUBMISSION_MODES))
  .min(1, "Leave students at least one way to submit.")
  .transform((values) => [...new Set(values)]);

export const examCreateSchema = z.object({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  totalQuestions: z.coerce.number().int().positive().max(MAX_TOTAL_QUESTIONS),
  category: z.string().trim().max(255).nullish(),
  examDate: z.coerce.date().nullish(),
  paperSeries: paperSeriesSchema.optional(),
  // All optional: a paper that sets none of these behaves as it always has.
  keySource: z.enum(KEY_SOURCES).optional(),
  marksCorrect: z.coerce.number().min(0).max(100).nullish(),
  marksWrong: z.coerce.number().min(0).max(100).nullish(),
  syllabus: syllabusSchema.optional(),
  rankBy: rankBySchema.optional(),
  paperShifts: paperShiftsSchema.optional(),
  submissionModes: submissionModesSchema.optional(),
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

export const submissionCreateSchema = z.object({
  series: seriesSchema.nullish(),
  sheet_url: z.string().trim().min(1).max(2000).optional(),
});

/** A student who has no sheet to hand types their total; ranks are overall (+ category) only. */
export const marksSubmissionSchema = z.object({
  series: seriesSchema.nullish(),
  marks: z.coerce.number().finite().min(-10000).max(10000),
  /** The slot sat; the service requires it when the paper ranks by shift. */
  shift: shiftKeySchema.nullish(),
});

export const correctionsSchema = z.object({
  corrections: z.record(z.string().regex(QUESTION_NUMBER), z.number().int().positive().nullable()),
  /** For a sheet that printed no shift; ignored when the sheet names one. */
  shift: shiftKeySchema.nullish(),
});

/** Narrow a board. A student's request needs the matching breakdown switched on for the paper. */
export const leaderboardScopeQuerySchema = z.object({
  shift: shiftKeySchema.optional(),
  category: z.enum(CASTE_CATEGORIES).optional(),
  gender: z.enum(GENDERS).optional(),
  exServiceman: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
  subject: z.string().trim().min(1).max(100).optional(),
});

export const leaderboardQuerySchema = leaderboardScopeQuerySchema.extend({
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
