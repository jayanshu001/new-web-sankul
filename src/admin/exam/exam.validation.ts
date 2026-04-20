import { z } from "zod";
import {
  ExamType,
  ExamStatus,
  ExamDifficulty,
  ExamLanguage,
  ExamQuestionType,
} from "../../models/enums";

// ─── Category ─────────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  image: z.string().max(500).optional(),
  parentId: z.string().nullable().optional(),
  orderBy: z.number().int().optional(),
  status: z.boolean().optional(),
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
  sendReminder: z.boolean().optional(),
});

export const updateExamSchema = createExamSchema.partial();

export const reorderExamsSchema = z.object({
  orders: z.array(z.object({ id: z.string(), orderBy: z.number().int() })).min(1),
});

// ─── Question ─────────────────────────────────────────────────────────────────

const optionSchema = z.object({
  text: z.string().min(1).max(1000),
  image: z.string().max(500).optional(),
  isCorrect: z.boolean().default(false),
});

export const createQuestionSchema = z.object({
  examId: z.string().min(1),
  title: z.string().min(1),
  image: z.string().max(500).optional(),
  solutionText: z.string().optional(),
  solutionImage: z.string().max(500).optional(),
  type: z
    .enum([ExamQuestionType.SINGLE, ExamQuestionType.MULTI])
    .default(ExamQuestionType.SINGLE),
  options: z.array(optionSchema).min(2),
  positiveMarksOverride: z.number().nullable().optional(),
  negativeMarksOverride: z.number().nullable().optional(),
  orderBy: z.number().int().optional(),
  status: z.boolean().optional(),
});

export const updateQuestionSchema = createQuestionSchema.partial().omit({ examId: true });

export const reorderQuestionsSchema = z.object({
  orders: z.array(z.object({ id: z.string(), orderBy: z.number().int() })).min(1),
});

export const bulkCreateQuestionsSchema = z.object({
  examId: z.string().min(1),
  questions: z.array(createQuestionSchema.omit({ examId: true })).min(1),
});
