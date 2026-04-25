import { z } from "zod";
import {
  ExamType,
  ExamStatus,
  ExamDifficulty,
  ExamLanguage,
} from "../../models/enums";

// ─── Category ─────────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  image: z.string().max(500).optional(),
  parentId: z.string().nullable().optional(),
  orderBy: z.coerce.number().int().optional(),
  status: z.coerce.boolean().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

// ─── Exam ─────────────────────────────────────────────────────────────────────

export const createExamSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z
    .enum([ExamType.DAILY, ExamType.SUBJECT, ExamType.MOCK, ExamType.WEEKLY])
    .default(ExamType.SUBJECT),
  categoryId: z.string().nullable().optional(),
  isPaid: z.boolean().optional(),
  durationMinutes: z.number().int().positive(),
  questionCount: z.number().int().positive(),
  positiveMarks: z.number().nonnegative(),
  negativeMarks: z.number(),
  passingMarks: z.number().nonnegative().optional(),
  solutionPdfUrl: z.string().max(500).optional(),
  instructions: z.string().optional(),
  policy: z.string().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  status: z
    .enum([ExamStatus.DRAFT, ExamStatus.SCHEDULED, ExamStatus.PUBLISHED, ExamStatus.ARCHIVED])
    .optional(),
  orderBy: z.number().int().optional(),
  language: z
    .enum([ExamLanguage.ENGLISH, ExamLanguage.GUJARATI, ExamLanguage.HINDI, ExamLanguage.BILINGUAL])
    .optional(),
  difficulty: z
    .enum([ExamDifficulty.EASY, ExamDifficulty.MEDIUM, ExamDifficulty.HARD])
    .optional(),
  sendPush: z.boolean().optional(),
});

export const updateExamSchema = createExamSchema.partial();

export const reorderExamsSchema = z.object({
  orders: z.array(z.object({ id: z.string(), orderBy: z.number().int() })).min(1),
});

// ─── Question ─────────────────────────────────────────────────────────────────
// Matches old schema: question has `answer` (text), options live in separate collection.
// A special option named "skip" is allowed — submitting it counts as a skipped answer.

const optionSchema = z.object({
  name: z.string().min(1).max(1000),
  image: z.string().max(500).optional(),
  orderBy: z.number().int().optional(),
});

const questionBase = {
  title: z.string().min(1),
  answer: z.string().min(1).max(1000),
  image: z.string().max(500).optional(),
  solutionText: z.string().optional(),
  solutionImage: z.string().max(500).optional(),
  options: z.array(optionSchema).min(2),
  orderBy: z.number().int().optional(),
  status: z.boolean().optional(),
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
