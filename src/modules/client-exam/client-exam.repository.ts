import { prisma } from "../../config/prisma";
import { examInCategoryWhere, subjectStartedWhere } from "../catalog-exam/exam-category-pivot.where";
import { searchTokens } from "../../utils/searchFilter";

/**
 * Prisma READ persistence for the client-exam MySQL branch.
 * Tables: ws_exam, ws_exam_category, ws_exam_question(_option),
 * ws_exam_result(_detail). Writes (saveAnswers scoring) are a deferred second
 * pass. type enum: 'subject' | 'daily' (ExamType). status boolean = published.
 *
 * ⚠ Legacy column quirks (handled in the service): result tables use the
 * `qresult_*` prefix; `exam.questions` is a count; `question.answer` stores the
 * correct answer (text), not surfaced to the client during an attempt.
 */
export const clientExamRepository = {
  findPublishedExam: (id: number) =>
    prisma.exam.findFirst({ where: { id, status: true } }),

  /** Active subject sub-categories of a parent (the "subjects" list). */
  subCategories: (parentId: number) =>
    prisma.examCategory.findMany({
      where: { parent: parentId, status: true, deleted: false },
      select: { id: true, name: true, image: true, order_by: true },
      orderBy: [{ order_by: "asc" }, { name: "asc" }],
    }),

  /** Published exams in a category (pivot-aware), hiding scheduled exams whose window ended. */
  examsByCategory: (categoryId: number, now: Date, search?: string | null) =>
    prisma.exam.findMany({
      where: {
        AND: [
          examInCategoryWhere(categoryId),
          { status: true },
          ...searchTokens(search).map((t) => ({ name: { contains: t } })),
          { OR: [{ type: "subject" }, { endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ order_by: "asc" }, { createAt: "desc" }],
    }),

  /** Single exam category (for the listing header). */
  findCategory: (id: number) =>
    prisma.examCategory.findFirst({ where: { id }, select: { id: true, name: true, image: true, order_by: true } }),

  /** Published non-daily exams in a category, paginated + optional title search. */
  examsByCategoryPaged: (categoryId: number, now: Date, search: string | null, skip: number, take: number) =>
    prisma.exam.findMany({
      where: {
        AND: [
          examInCategoryWhere(categoryId),
          { status: true, type: "subject" },
          ...searchTokens(search).map((t) => ({ name: { contains: t } })),
          // subject exams: only once started (see subjectStartedWhere) and before the window ends.
          subjectStartedWhere(now),
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ order_by: "asc" }, { createAt: "desc" }],
      skip,
      take,
    }),
  countExamsByCategoryPaged: (categoryId: number, now: Date, search: string | null) =>
    prisma.exam.count({
      where: {
        AND: [
          examInCategoryWhere(categoryId),
          { status: true, type: "subject" },
          ...searchTokens(search).map((t) => ({ name: { contains: t } })),
          // subject exams: only once started (see subjectStartedWhere) and before the window ends.
          subjectStartedWhere(now),
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
    }),

  /** Questions of an exam (without revealing the answer field). */
  questionsForExam: (examId: number) =>
    prisma.examQuestion.findMany({
      where: { exam: examId, status: true },
      orderBy: [{ order_by: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, image: true, order_by: true },
    }),

  optionsForQuestions: (questionIds: number[]) =>
    prisma.examQuestionOption.findMany({
      where: { question: { in: questionIds } },
      orderBy: [{ id: "asc" }],
    }),

  /** Latest result per exam for a customer (for the isCompleted/lastResult deco). */
  resultsForCustomerExams: (customerId: number, examIds: number[]) =>
    prisma.examResult.findMany({
      where: { customerId, examId: { in: examIds }, status: true },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    }),

  /** A customer's results, paginated (my-results), optional exam-name search. */
  myResults: (customerId: number, skip: number, take: number, search?: string | null) =>
    prisma.examResult.findMany({
      where: { customerId, status: true, ...(search ? { AND: searchTokens(search).map((t) => ({ Exam: { name: { contains: t } } })) } : {}) },
      include: { Exam: { select: { id: true, name: true } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
  countMyResults: (customerId: number, search?: string | null) =>
    prisma.examResult.count({ where: { customerId, status: true, ...(search ? { AND: searchTokens(search).map((t) => ({ Exam: { name: { contains: t } } })) } : {}) } }),

  findResult: (id: number, customerId: number) =>
    prisma.examResult.findFirst({ where: { id, customerId } }),

  /** Lifetime aggregate analytics row for a customer (one per customer). */
  overallAnalytics: (customerId: number) =>
    prisma.examResultDetailAnalytics.findFirst({ where: { customerId } }),

  /** First result row for (customer, exam) — mirrors Mongo findOne natural order. */
  findResultByExam: (customerId: number, examId: number) =>
    prisma.examResult.findFirst({ where: { customerId, examId } }),

  /** Set the rating on a single result row by id, returning the updated row. */
  rateResult: (id: number, ratting: string) =>
    prisma.examResult.update({ where: { id }, data: { ratting } }),

  /** Past (submitted) attempts of DAILY-type exams, paginated, optional name search. */
  pastDailyResults: (customerId: number, skip: number, take: number, search?: string | null) =>
    prisma.examResult.findMany({
      where: { customerId, status: true, inProgress: false, submittedAt: { not: null }, Exam: { type: "daily", ...(search ? { AND: searchTokens(search).map((t) => ({ name: { contains: t } })) } : {}) } },
      include: {
        Exam: {
          select: { id: true, name: true, type: true, time: true, positiveMarks: true, negativeMarks: true, startAt: true },
        },
      },
      orderBy: [{ submittedAt: "desc" }, { attemptNumber: "desc" }],
      skip,
      take,
    }),
  countPastDailyResults: (customerId: number, search?: string | null) =>
    prisma.examResult.count({
      where: { customerId, status: true, inProgress: false, submittedAt: { not: null }, Exam: { type: "daily", ...(search ? { AND: searchTokens(search).map((t) => ({ name: { contains: t } })) } : {}) } },
    }),

  /** Daily-exam drill-down counts by year/month/week via raw SQL date grouping. */
  dailyYears: (now: Date) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT YEAR(COALESCE(start_date, created_at)) AS year, COUNT(*) AS testsCount
       FROM ws_exam WHERE type='daily' AND status=1
       GROUP BY year ORDER BY year DESC`
    ),
  dailyMonths: (year: number) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT MONTH(COALESCE(start_date, created_at)) AS month, COUNT(*) AS testsCount
       FROM ws_exam WHERE type='daily' AND status=1 AND YEAR(COALESCE(start_date, created_at))=?
       GROUP BY month ORDER BY month DESC`, year
    ),
  dailyInWindow: (from: Date, to: Date) =>
    prisma.exam.findMany({
      where: { type: "daily", status: true, OR: [{ startAt: { gte: from, lte: to } }, { startAt: null, createAt: { gte: from, lte: to } }] },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
    }),
  /** Daily exams in a window, paginated + optional name search (tests level). */
  dailyInWindowPaged: (from: Date, to: Date, search: string | null, skip: number, take: number) =>
    prisma.exam.findMany({
      where: {
        type: "daily",
        status: true,
        ...(search ? { AND: searchTokens(search).map((t) => ({ name: { contains: t } })) } : {}),
        OR: [{ startAt: { gte: from, lte: to } }, { startAt: null, createAt: { gte: from, lte: to } }],
      },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
  countDailyInWindow: (from: Date, to: Date, search: string | null) =>
    prisma.exam.count({
      where: {
        type: "daily",
        status: true,
        ...(search ? { AND: searchTokens(search).map((t) => ({ name: { contains: t } })) } : {}),
        OR: [{ startAt: { gte: from, lte: to } }, { startAt: null, createAt: { gte: from, lte: to } }],
      },
    }),

  // ─── saveAnswers WRITE path ────────────────────────────────────────────────
  findExam: (id: number) => prisma.exam.findUnique({ where: { id } }),
  findQuestion: (id: number, examId: number) =>
    prisma.examQuestion.findFirst({ where: { id, exam: examId } }),
  findOption: (id: number, questionId: number) =>
    prisma.examQuestionOption.findFirst({ where: { id, question: questionId } }),

  /** Insert the result + its details in one transaction. Returns the result row. */
  createResult: (input: {
    customerId: number; examId: number; total: number; attempt: number; skip: number;
    success: number; failed: number; score: number; timing: string; ratting: string | null;
    details: Array<{ questionId: number; answerId: number; result: "true" | "false" | "skip"; point: number }>;
  }) =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.examResult.create({
        data: {
          customerId: input.customerId, examId: input.examId, total: input.total,
          attempt: input.attempt, skip: input.skip, success: input.success, failed: input.failed,
          score: input.score, timing: input.timing, ratting: input.ratting, status: true,
          created_at: now,
        },
      });
      for (const d of input.details) {
        await tx.examResultDetail.create({
          data: {
            examResultId: result.id, customerId: input.customerId, examId: input.examId,
            questionId: d.questionId, answerId: d.answerId, result: d.result, point: d.point,
          },
        });
      }
      return result;
    }),

  /** Recompute the analytics rollup for a customer (upsert into the analytics table). */
  recomputeAnalytics: async (customerId: number) => {
    const agg = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(DISTINCT qresult_qtest_id) exams, COALESCE(SUM(qresult_total),0) questions,
              COALESCE(SUM(qresult_attempt),0) attempt, COALESCE(SUM(qresult_skip),0) skip,
              COALESCE(SUM(qresult_true),0) success, COALESCE(SUM(qresult_false),0) failed,
              COALESCE(SUM(qresult_result),0) score
       FROM ws_exam_result WHERE qresult_customer_id=? AND qresult_status=1`, customerId
    );
    const a = agg[0] ?? {};
    const data = {
      exams: Number(a.exams) || 0, questions: Number(a.questions) || 0, attempt: Number(a.attempt) || 0,
      skip: Number(a.skip) || 0, success: Number(a.success) || 0, failed: Number(a.failed) || 0,
      score: Number(a.score) || 0,
    };
    const existing = await prisma.examResultDetailAnalytics.findFirst({ where: { customerId } });
    if (existing) {
      await prisma.examResultDetailAnalytics.update({ where: { id: existing.id }, data });
    } else {
      await prisma.examResultDetailAnalytics.create({ data: { customerId, ...data } });
    }
  },

  /** Best score per customer for an exam (for rank). */
  bestScoresForExam: (examId: number) =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT qresult_customer_id customerId, MAX(qresult_result) best
       FROM ws_exam_result WHERE qresult_qtest_id=? AND qresult_status=1
       GROUP BY qresult_customer_id`, examId
    ),

  // ─── Solution view ──────────────────────────────────────────────────────────
  latestResultForExam: (customerId: number, examId: number) =>
    prisma.examResult.findFirst({
      where: { customerId, examId, status: true },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    }),
  findResultById: (id: number, customerId: number, examId: number) =>
    prisma.examResult.findFirst({ where: { id, customerId, examId, status: true } }),
  detailsForResult: (resultId: number) =>
    prisma.examResultDetail.findMany({ where: { examResultId: resultId } }),
  questionsByIds: (ids: number[]) =>
    prisma.examQuestion.findMany({ where: { id: { in: ids } } }),

  // ─── attempt lifecycle (resumable attempts) ────────────────────────────────
  /** The customer's open (in-progress) attempt for an exam, if any. */
  findInProgressAttempt: (customerId: number, examId: number) =>
    prisma.examResult.findFirst({
      where: { customerId, examId, status: false },
      orderBy: [{ id: "desc" }],
    }),

  /** Highest attempt number this customer has used for an exam (null if none). */
  maxAttemptNumber: async (customerId: number, examId: number): Promise<number> => {
    const r = await prisma.examResult.aggregate({
      where: { customerId, examId },
      _max: { attemptNumber: true },
    });
    return r._max.attemptNumber ?? 0;
  },

  /** Open a fresh in-progress attempt row (status=false). */
  createInProgressAttempt: (input: {
    customerId: number; examId: number; attemptNumber: number; startedAt: Date;
  }) =>
    prisma.examResult.create({
      data: {
        customerId: input.customerId, examId: input.examId, attemptNumber: input.attemptNumber,
        total: 0, attempt: 0, skip: 0, success: 0, failed: 0, score: 0, timing: "00:00",
        startedAt: input.startedAt, submittedAt: null, inProgress: true, status: false,
        created_at: input.startedAt,
      },
    }),

  /** A specific attempt scoped to its owner + exam. */
  findAttempt: (id: number, customerId: number, examId: number) =>
    prisma.examResult.findFirst({ where: { id, customerId, examId } }),

  /** Upsert a single saved answer detail by (attempt, question). */
  upsertAttemptDetail: async (input: {
    examResultId: number; customerId: number; examId: number; questionId: number;
    answerId: number | null; result: "true" | "false" | "skip"; point: number;
  }) => {
    const existing = await prisma.examResultDetail.findFirst({
      where: { examResultId: input.examResultId, questionId: input.questionId },
      select: { id: true },
    });
    if (existing) {
      return prisma.examResultDetail.update({
        where: { id: existing.id },
        data: { answerId: input.answerId, result: input.result, point: input.point },
      });
    }
    return prisma.examResultDetail.create({
      data: {
        examResultId: input.examResultId, customerId: input.customerId, examId: input.examId,
        questionId: input.questionId, answerId: input.answerId, result: input.result, point: input.point,
      },
    });
  },

  /** Published question ids for an exam (for submit's unanswered → skip fill). */
  questionIdsForExam: (examId: number) =>
    prisma.examQuestion.findMany({ where: { exam: examId, status: true }, select: { id: true } }),

  /**
   * Finalize an attempt: insert SKIP details for any unanswered question, then
   * write the rolled-up totals + mark submitted. Returns the updated row.
   */
  finalizeAttempt: (input: {
    attemptId: number; customerId: number; examId: number;
    missingQuestionIds: number[];
    total: number; attempt: number; skip: number; success: number; failed: number;
    score: number; timing: string; ratting: string | null; submittedAt: Date;
  }) =>
    prisma.$transaction(async (tx) => {
      for (const qid of input.missingQuestionIds) {
        await tx.examResultDetail.create({
          data: {
            examResultId: input.attemptId, customerId: input.customerId, examId: input.examId,
            questionId: qid, answerId: null, result: "skip", point: 0,
          },
        });
      }
      return tx.examResult.update({
        where: { id: input.attemptId },
        data: {
          total: input.total, attempt: input.attempt, skip: input.skip,
          success: input.success, failed: input.failed, score: input.score,
          timing: input.timing, ratting: input.ratting,
          status: true, inProgress: false, submittedAt: input.submittedAt,
        },
      });
    }),

  /** All of a customer's attempts for an exam (history, newest first), paginated. */
  attemptsForExam: (customerId: number, examId: number, skip?: number, take?: number) =>
    prisma.examResult.findMany({
      where: { customerId, examId },
      orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
      ...(skip != null ? { skip } : {}),
      ...(take != null ? { take } : {}),
    }),
  countAttemptsForExam: (customerId: number, examId: number) =>
    prisma.examResult.count({ where: { customerId, examId } }),

  /** Aggregate stats across a customer's SUBMITTED attempts for an exam. */
  aggregateForExam: (customerId: number, examId: number) =>
    prisma.examResult.aggregate({
      where: { customerId, examId, status: true },
      _count: { _all: true },
      _sum: { total: true, attempt: true, skip: true, success: true, failed: true, score: true },
      _max: { score: true, submittedAt: true },
    }),
};
