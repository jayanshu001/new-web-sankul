import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-exam MySQL branch (READ-focused + invalidate).
 * Same ws_exam* tables as client-exam; admin-shaped queries (filters, populated
 * customer, per-exam/per-question aggregates). Result tables use qresult_*.
 */
export const adminExamRepository = {
  // ── exams ──────────────────────────────────────────────────────────────────
  listExams: (opts: { search?: string; categoryId?: number; type?: "subject" | "daily"; status?: boolean; isPaid?: boolean; skip: number; take: number }) => {
    const where: Prisma.ExamWhereInput = {};
    if (opts.search) where.name = { contains: opts.search.trim() };
    if (opts.categoryId !== undefined) where.examCategoryId = opts.categoryId;
    if (opts.type) where.type = opts.type;
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.isPaid !== undefined) where.isPaid = opts.isPaid;
    return prisma.exam.findMany({
      where,
      include: { ExamCategory: { select: { id: true, name: true } } },
      orderBy: [{ order_by: "asc" }, { createAt: "desc" }],
      skip: opts.skip,
      take: opts.take,
    });
  },
  countExams: (opts: { search?: string; categoryId?: number; type?: "subject" | "daily"; status?: boolean; isPaid?: boolean }) => {
    const where: Prisma.ExamWhereInput = {};
    if (opts.search) where.name = { contains: opts.search.trim() };
    if (opts.categoryId !== undefined) where.examCategoryId = opts.categoryId;
    if (opts.type) where.type = opts.type;
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.isPaid !== undefined) where.isPaid = opts.isPaid;
    return prisma.exam.count({ where });
  },
  findExam: (id: number) =>
    prisma.exam.findUnique({ where: { id }, include: { ExamCategory: { select: { id: true, name: true } } } }),
  countQuestionsForExam: (examId: number) => prisma.examQuestion.count({ where: { exam: examId } }),

  // ── questions ────────────────────────────────────────────────────────────────
  listQuestions: (opts: { examId?: number; search?: string; status?: boolean; skip: number; take: number }) => {
    const where: Prisma.ExamQuestionWhereInput = {};
    if (opts.examId !== undefined) where.exam = opts.examId;
    if (opts.search) where.name = { contains: opts.search.trim() };
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.examQuestion.findMany({ where, orderBy: [{ order_by: "asc" }, { createdAt: "asc" }], skip: opts.skip, take: opts.take });
  },
  countQuestions: (opts: { examId?: number; search?: string; status?: boolean }) => {
    const where: Prisma.ExamQuestionWhereInput = {};
    if (opts.examId !== undefined) where.exam = opts.examId;
    if (opts.search) where.name = { contains: opts.search.trim() };
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.examQuestion.count({ where });
  },
  findQuestion: (id: number) => prisma.examQuestion.findUnique({ where: { id } }),
  optionsForQuestions: (questionIds: number[]) =>
    prisma.examQuestionOption.findMany({ where: { question: { in: questionIds } }, orderBy: { id: "asc" } }),

  // ── submissions / results ──────────────────────────────────────────────────
  listSubmissions: (examId: number, skip: number, take: number) =>
    prisma.examResult.findMany({
      where: { examId },
      include: { Customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } } },
      orderBy: [{ score: "desc" }, { id: "asc" }],
      skip,
      take,
    }),
  countSubmissions: (examId: number) => prisma.examResult.count({ where: { examId } }),

  findResult: (id: number) =>
    prisma.examResult.findUnique({
      where: { id },
      include: {
        Customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        Exam: { select: { id: true, name: true, type: true, time: true } },
      },
    }),
  detailsForResult: (resultId: number) => prisma.examResultDetail.findMany({ where: { examResultId: resultId } }),

  invalidateResult: (id: number) =>
    prisma.examResult.update({ where: { id }, data: { status: false, score: 0 } }),

  customerAnalytics: (customerId: number) =>
    prisma.examResultDetailAnalytics.findFirst({ where: { customerId } }),

  // ── analytics (raw SQL aggregates on qresult_* columns) ──────────────────────
  examOverall: (examId: number) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) totalCandidates, ROUND(AVG(qresult_result),2) avgScore,
              MAX(qresult_result) maxScore, MIN(qresult_result) minScore,
              ROUND(AVG(CASE WHEN qresult_total>0 THEN qresult_true*100/qresult_total ELSE 0 END),2) avgAccuracy
       FROM ws_exam_result WHERE qresult_qtest_id=?`, examId
    ),
  examPerQuestion: (examId: number) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT d.qresult_detail_question_id questionId, q.title questionTitle,
              COUNT(*) total,
              SUM(d.qresult_detail_result='true') correct,
              SUM(d.qresult_detail_result='false') wrong,
              SUM(d.qresult_detail_result='skip') skipped,
              CASE WHEN COUNT(*)=0 THEN 0 ELSE ROUND(SUM(d.qresult_detail_result='true')*100/COUNT(*),2) END accuracy
       FROM ws_exam_result_detail d
       LEFT JOIN ws_exam_question q ON q.id = d.qresult_detail_question_id
       WHERE d.qresult_detail_qtest_id=?
       GROUP BY d.qresult_detail_question_id, q.title
       ORDER BY accuracy ASC`, examId
    ),
};
