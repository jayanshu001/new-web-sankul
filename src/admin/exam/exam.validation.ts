import { z } from "zod";
import { ExamType } from "../../shared/enums";

// ─── Category ─────────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  // URL (set), absence (unchanged), or null / "" (clear). On update the
  // controller turns a null/empty value into a $unset so the FE can remove the
  // category image via JSON `image: null` or an empty multipart field.
  image: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().max(500).nullable().optional()
  ),
  parentId: z.string().nullable().optional(),
  childCategoryIds: z.array(z.string()).optional(),
  orderBy: z.coerce.number().int().optional(),
  status: z.coerce.boolean().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

// ─── Exam ─────────────────────────────────────────────────────────────────────

export const createExamSchema = z
  .object({
    title: z.string().min(1).max(255),
    durationMinutes: z.coerce.number().int().positive(),
    questionCount: z.coerce.number().int().nonnegative().optional(),
    // Full-replace set of leaf category ids. A single selection arrives from a
    // multipart form as ONE `categoryIds[]` key (a bare scalar, not an array), so
    // lift it before validating — otherwise picking exactly one category while
    // uploading a solution PDF would 400. Existence + leaf-ness are checked in the
    // service, which needs the DB; here we only enforce shape and non-emptiness.
    categoryIds: z.preprocess(
      (v) => (v === undefined || Array.isArray(v) ? v : [v]),
      z.array(z.string().min(1)).nonempty("At least one parent category is required").optional()
    ),
    // Legacy single-category form, still accepted so older clients keep working.
    categoryId: z.string().nullable().optional(),
    type: z
      .enum([ExamType.DAILY, ExamType.SUBJECT, ExamType.MOCK, ExamType.WEEKLY])
      .default(ExamType.SUBJECT),
    positiveMarks: z.coerce.number().nonnegative(),
    negativeMarks: z.coerce.number(),
    // Accept a date (set), absence (leave unchanged), or null / "" (clear → null the
    // column). Mirrors solutionPdfUrl: without the null/"" handling a JSON null would
    // coerce to the 1970 epoch and a multipart "" would 422, so the cleared window
    // never persisted. The service writes null through (admin-exam.service updateExam).
    startAt: z.preprocess(
      (v) => (v === "" ? null : v),
      z.coerce.date().nullable().optional()
    ),
    endAt: z.preprocess(
      (v) => (v === "" ? null : v),
      z.coerce.date().nullable().optional()
    ),
    // Accept a URL (set), absence (leave unchanged), or null / "" (clear). The
    // controller translates a null/empty value into a $unset so the FE can
    // remove an attached solution PDF via JSON `solutionPdfUrl: null`.
    solutionPdfUrl: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().max(500).nullable().optional()
    ),
    // Original filename of the uploaded solution PDF (paired with solutionPdfUrl).
    solutionPdfName: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().max(255).nullable().optional()
    ),
    sendPush: z.coerce.boolean().optional(),
    isPaid: z.coerce.boolean().optional(),
    status: z.coerce.boolean().optional(),
  })
  .superRefine(requireDailyWindow);

// Daily tests live in a fixed availability window, so both ends are mandatory
// and the window must be non-empty. Shared by create (full payload) and the
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
    // On update the window rule is enforced in the controller against the
    // merged effective values; here we only validate ordering when both
    // ends are present in the payload.
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

// ─── Question ─────────────────────────────────────────────────────────────────
// Matches old schema: question has `answer` (text), options live in separate collection.
// A special option named "skip" is allowed — submitting it counts as a skipped answer.

const optionSchema = z.object({
  name: z.string().min(1).max(1000),
  // Allow URL, empty string (= clear), or absent. Final coercion happens in controller.
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
