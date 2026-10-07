// Client exams: Prisma queries for exams, attempts and results.
import { prisma } from "../../config/prisma";
import { examInCategoriesWhere, subjectStartedWhere } from "../catalog-exam/exam-category-pivot.where";
import { searchTokens } from "../../utils/searchFilter";

/**
 * Legacy column quirks: result tables use the `qresult_*` prefix, `exam.questions`
 * is a count, and `question.answer` holds the correct answer (never surfaced
 * during an attempt).
 */
export const clientExamRepository = {
  findPublishedExam: (id: number) =>
    prisma.exam.findFirst({ where: { id, status: true } }),

  subCategories: (parentId: number) =>
    prisma.examCategory.findMany({
      where: { parent: parentId, status: true, deleted: false },
      select: { id: true, name: true, image: true, order_by: true },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    }),

  /**
   * Takes the expanded id set (self + descendants): exams are filed only under leaf
   * categories. Scheduled exams whose window ended are hidden.
   */
  examsByCategory: (categoryIds: number[], now: Date, search?: string | null) =>
    prisma.exam.findMany({
      where: {
        AND: [
          examInCategoriesWhere(categoryIds),
          { status: true },
          ...searchTokens(search).map((t) => ({ name: { contains: t } })),
          { OR: [{ type: "subject" }, { endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ order_by: "asc" }, { createAt: "asc" }],
    }),

  findCategory: (id: number) =>
    prisma.examCategory.findFirst({ where: { id }, select: { id: true, name: true, image: true, order_by: true } }),

  examsByCategoryPaged: (categoryIds: number[], now: Date, search: string | null, skip: number, take: number) =>
    prisma.exam.findMany({
      where: {
        AND: [
          examInCategoriesWhere(categoryIds),
          { status: true, type: "subject" },
          ...searchTokens(search).map((t) => ({ name: { contains: t } })),
          subjectStartedWhere(now),
        ],
      },
      orderBy: [{ order_by: "asc" }, { createAt: "asc" }],
      skip,
      take,
    }),
  countExamsByCategoryPaged: (categoryIds: number[], now: Date, search: string | null) =>
    prisma.exam.count({
      where: {
        AND: [
          examInCategoriesWhere(categoryIds),
          { status: true, type: "subject" },
          ...searchTokens(search).map((t) => ({ name: { contains: t } })),
          subjectStartedWhere(now),
        ],
      },
    }),

  /** Never selects the `answer` field. */
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

  resultsForCustomerExams: (customerId: number, examIds: number[]) =>
    prisma.examResult.findMany({
      where: { customerId, examId: { in: examIds }, status: true },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    }),

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

  /**
   * Aggregated live from submitted ws_exam_result rows (legacy attempts included);
   * the ws_exam_result_detail_analytics rollup is deliberately not used.
   */
  overallAnalytics: async (customerId: number) => {
    const agg = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(DISTINCT qresult_qtest_id) exams, COALESCE(SUM(qresult_total),0) questions,
              COALESCE(SUM(qresult_attempt),0) attempt, COALESCE(SUM(qresult_skip),0) skip,
              COALESCE(SUM(qresult_true),0) success, COALESCE(SUM(qresult_false),0) failed,
              COALESCE(SUM(qresult_result),0) score
       FROM ws_exam_result WHERE qresult_customer_id=? AND qresult_status=1`, customerId
    );
    const a = agg[0] ?? {};
    return {
      exams: Number(a.exams) || 0, questions: Number(a.questions) || 0, attempt: Number(a.attempt) || 0,
      skip: Number(a.skip) || 0, success: Number(a.success) || 0, failed: Number(a.failed) || 0,
      score: Number(a.score) || 0,
    };
  },

  /** Mirrors legacy natural order (no orderBy). */
  findResultByExam: (customerId: number, examId: number) =>
    prisma.examResult.findFirst({ where: { customerId, examId } }),

  rateResult: (id: number, ratting: string) =>
    prisma.examResult.update({ where: { id }, data: { ratting } }),

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

  findExam: (id: number) => prisma.exam.findUnique({ where: { id } }),
  findQuestion: (id: number, examId: number) =>
    prisma.examQuestion.findFirst({ where: { id, exam: examId } }),
  findOption: (id: number, questionId: number) =>
    prisma.examQuestionOption.findFirst({ where: { id, question: questionId } }),

  /**
   * Used to recognise legacy skip rows: a pre-cutover result points `answer_id` at
   * an option named "Skip".
   */
  optionsByIds: (ids: number[]) =>
    ids.length
      ? prisma.examQuestionOption.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : Promise.resolve([]),

  createResult: (input: {
    customerId: number; examId: number; total: number; attempt: number; skip: number;
    success: number; failed: number; score: number; timing: string; ratting: string | null;
      // NULL for a skipped question.
    details: Array<{ questionId: number; answerId: number | null; result: "true" | "false" | "skip"; point: number }>;
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

  /** Index-only via idx_exam_result_cust_exam_status (customer, exam, status). */
  myBestScoreForExam: async (customerId: number, examId: number): Promise<number> => {
    const r = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(qresult_result),0) best
       FROM ws_exam_result
       WHERE qresult_customer_id=? AND qresult_qtest_id=? AND qresult_status=1`,
      customerId, examId
    );
    return Number(r[0]?.best ?? 0);
  },

  /**
   * Ties share a rank (rank = customers strictly better + 1), aggregated in SQL
   * rather than shipping one row per candidate to Node. Needs
   * idx_exam_result_exam_status (qresult_qtest_id, qresult_status); the
   * (customer, exam, status) index cannot serve an exam-only filter.
   */
  rankForExam: async (
    examId: number,
    myBest: number
  ): Promise<{ higher: number; candidates: number }> => {
    const [candidates, higher] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(DISTINCT qresult_customer_id) c
         FROM ws_exam_result WHERE qresult_qtest_id=? AND qresult_status=1`,
        examId
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) c FROM (
           SELECT qresult_customer_id
           FROM ws_exam_result
           WHERE qresult_qtest_id=? AND qresult_status=1
           GROUP BY qresult_customer_id
           HAVING MAX(qresult_result) > ?
         ) t`,
        examId, myBest
      ),
    ]);
    return {
      candidates: Number(candidates[0]?.c ?? 0),
      higher: Number(higher[0]?.c ?? 0),
    };
  },

  latestResultForExam: (customerId: number, examId: number) =>
    prisma.examResult.findFirst({
      where: { customerId, examId, status: true },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    }),
  findResultById: (id: number, customerId: number, examId: number) =>
    prisma.examResult.findFirst({ where: { id, customerId, examId, status: true } }),
  detailsForResult: (resultId: number) =>
    prisma.examResultDetail.findMany({ where: { examResultId: resultId } }),
  /**
   * Legacy attempts wrote detail rows with a NULL qresult_detail_qresult_id, linked
   * only by (customer, exam); legacy allowed one attempt per pair.
   */
  legacyDetailsForExam: (customerId: number, examId: number) =>
    prisma.examResultDetail.findMany({ where: { examResultId: null, customerId, examId }, orderBy: { id: "asc" } }),
  questionsByIds: (ids: number[]) =>
    prisma.examQuestion.findMany({ where: { id: { in: ids } } }),

  findInProgressAttempt: (customerId: number, examId: number) =>
    prisma.examResult.findFirst({
      where: { customerId, examId, status: false },
      orderBy: [{ id: "desc" }],
    }),

  maxAttemptNumber: async (customerId: number, examId: number): Promise<number> => {
    const r = await prisma.examResult.aggregate({
      where: { customerId, examId },
      _max: { attemptNumber: true },
    });
    return r._max.attemptNumber ?? 0;
  },

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

  findAttempt: (id: number, customerId: number, examId: number) =>
    prisma.examResult.findFirst({ where: { id, customerId, examId } }),

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

  questionIdsForExam: (examId: number) =>
    prisma.examQuestion.findMany({ where: { exam: examId, status: true }, select: { id: true } }),

  finalizeAttempt: (input: {
    attemptId: number; customerId: number; examId: number;
    missingQuestionIds: number[];
    total: number; attempt: number; skip: number; success: number; failed: number;
    score: number; timing: string; ratting: string | null; submittedAt: Date;
  }) =>
    prisma.$transaction(async (tx) => {
      // One multi-row INSERT: a per-question loop held the write transaction open
      // across N round-trips and caused submit timeouts.
      if (input.missingQuestionIds.length) {
        await tx.examResultDetail.createMany({
          data: input.missingQuestionIds.map((qid) => ({
            examResultId: input.attemptId, customerId: input.customerId, examId: input.examId,
            questionId: qid, answerId: null, result: "skip" as const, point: 0,
          })),
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

  attemptsForExam: (customerId: number, examId: number, skip?: number, take?: number) =>
    prisma.examResult.findMany({
      where: { customerId, examId },
      orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
      ...(skip != null ? { skip } : {}),
      ...(take != null ? { take } : {}),
    }),
  countAttemptsForExam: (customerId: number, examId: number) =>
    prisma.examResult.count({ where: { customerId, examId } }),

  aggregateForExam: (customerId: number, examId: number) =>
    prisma.examResult.aggregate({
      where: { customerId, examId, status: true },
      _count: { _all: true },
      _sum: { total: true, attempt: true, skip: true, success: true, failed: true, score: true },
      _max: { score: true, submittedAt: true },
    }),
};
