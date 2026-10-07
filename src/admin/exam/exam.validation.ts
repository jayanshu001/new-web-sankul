// Admin quizzes: Zod request schemas.
import { z } from "zod";
import { ExamType } from "../../shared/enums";

export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  // URL (set), absent (unchanged), or null / "" (clear).
  image: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().max(500).nullable().optional()
  ),
  parentId: z.string().nullable().optional(),
  childCategoryIds: z.array(z.string()).optional(),
  // Blank multipart field → absent (coerce would turn "" into 0), so create
  // falls back to the sibling max+1 default.
  orderBy: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().int().optional()
  ),
  status: z.coerce.boolean().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createExamSchema = z
  .object({
    title: z.string().min(1).max(255),
    durationMinutes: z.coerce.number().int().positive(),
    questionCount: z.coerce.number().int().nonnegative().optional(),
    // Full-replace set of leaf ids. A single multipart selection arrives as a bare
    // scalar, so it is lifted to an array. Empty is valid (daily tests may have no
    // category); "at least one" is type-dependent and enforced in the service, which
    // also checks existence and leaf-ness. "" means "clear all" because multipart
    // sends no key at all for an empty array.
    categoryIds: z.preprocess(
      (v) => (v === "" ? [] : v === undefined || Array.isArray(v) ? v : [v]),
      z.array(z.string().min(1)).optional()
    ),
    // Legacy single-category form, still accepted for older clients.
    categoryId: z.string().nullable().optional(),
    type: z
      .enum([ExamType.DAILY, ExamType.SUBJECT, ExamType.MOCK, ExamType.WEEKLY])
      .default(ExamType.SUBJECT),
    positiveMarks: z.coerce.number().nonnegative(),
    negativeMarks: z.coerce.number(),
    // Date (set), absent (unchanged), or null / "" (clear). Without this a JSON
    // null would coerce to the 1970 epoch and a multipart "" would 422.
    startAt: z.preprocess(
      (v) => (v === "" ? null : v),
      z.coerce.date().nullable().optional()
    ),
    endAt: z.preprocess(
      (v) => (v === "" ? null : v),
      z.coerce.date().nullable().optional()
    ),
    // URL (set), absent (unchanged), or null / "" (clear).
    solutionPdfUrl: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().max(500).nullable().optional()
    ),
    solutionPdfName: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().max(255).nullable().optional()
    ),
    sendPush: z.coerce.boolean().optional(),
    isPaid: z.coerce.boolean().optional(),
    status: z.coerce.boolean().optional(),
  })
  .superRefine(requireDailyWindow);

// Daily tests need a non-empty availability window. Shared by create and the
// controller's update path (merged effective values).
function requireDailyWindow(
  data: { type?: string; startAt?: Date | null; endAt?: Date | null },
  ctx: z.RefinementCtx
) {
  if (data.type !== ExamType.DAILY) return;
  if (!data.startAt)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startAt"],
      message: "startAt is required for daily tests.",
    });
  if (!data.endAt)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endAt"],
      message: "endAt is required for daily tests.",
    });
  if (data.startAt && data.endAt && data.endAt <= data.startAt)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endAt"],
      message: "endAt must be after startAt.",
    });
}

// `.partial()` only works on a ZodObject, so derive it from the inner object
// (before the refine), then re-attach the same daily-window rule.
export const updateExamSchema = createExamSchema._def.schema
  .partial()
  .superRefine((data, ctx) => {
    // The full window rule runs in the controller against merged values; here
    // only ordering when both ends are present.
    if (data.startAt && data.endAt && data.endAt <= data.startAt)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must be after startAt.",
      });
  });

export const reorderExamsSchema = z.object({
  orders: z.array(z.object({ id: z.string(), orderBy: z.number().int() })).min(1),
});

// An option named "skip" is allowed; submitting it counts as a skipped answer.

const optionSchema = z.object({
  name: z.string().min(1).max(1000),
  // URL, "" (clear), or absent; coerced in the controller.

  image: z.string().max(500).optional(),
  orderBy: z.coerce.number().int().optional(),
});

const questionBase = {
  title: z.string().min(1),
  answer: z.string().min(1).max(1000),
  image: z.string().max(500).optional(),
  solutionText: z.string().optional(),
  solutionImage: z.string().max(500).optional(),
  options: z.array(optionSchema).min(2),
  orderBy: z.coerce.number().int().optional(),
  status: z.coerce.boolean().optional(),
};

export const createQuestionSchema = z.object({
  examId: z.string().min(1),
  ...questionBase,
});

export const updateQuestionSchema = z.object({
  title: questionBase.title.optional(),
  answer: questionBase.answer.optional(),
  image: questionBase.image,
  solutionText: questionBase.solutionText,
  solutionImage: questionBase.solutionImage,
  options: questionBase.options.optional(),
  orderBy: questionBase.orderBy,
  status: questionBase.status,
});

export const reorderQuestionsSchema = z.object({
  orders: z.array(z.object({ id: z.string(), orderBy: z.number().int() })).min(1),
});

export const bulkCreateQuestionsSchema = z.object({
  examId: z.string().min(1),
  questions: z
    .array(z.object(questionBase))
    .min(1),
});
