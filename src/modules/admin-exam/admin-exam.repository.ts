import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { examInCategoryWhere } from "../catalog-exam/exam-category-pivot.where";
import { buildPrismaSearch } from "../../utils/searchFilter";

/** Shape used by question create/bulk inserts (option image/order dropped — no columns). */
export interface QuestionWrite {
  examId: number;
  name: string;
  answer: string;
  image: string | null;
  solutionText: string; // ws_exam_question.solution_text is NOT NULL
  solutionImage: string | null;
  orderBy: number;
  status: boolean;
  options: { name: string }[];
}

/**
 * The exam's chosen categories, for the populated `categoryIds` DTO field. Excludes
 * soft-deleted categories: a link to one is inert everywhere else (every read filters
 * `deleted:false`), so surfacing it would render a chip the picker can't offer back.
 */
const examCategoriesInclude = {
  examCategoryPivot: {
    where: { Category: { deleted: false } },
    select: { Category: { select: { id: true, name: true } } },
    orderBy: { categoryId: "asc" },
  },
} satisfies Prisma.ExamInclude;

/** ws_exam.questions = count of ACTIVE (status=true) questions — mirrors the Mongo recompute. */
async function recomputeCount(tx: Prisma.TransactionClient, examId: number) {
  const count = await tx.examQuestion.count({ where: { exam: examId, status: true } });
  await tx.exam.update({ where: { id: examId }, data: { numberOfQuestions: count } });
}

/**
 * Prisma persistence for the admin-exam MySQL branch (READ-focused + invalidate).
 * Same ws_exam* tables as client-exam; admin-shaped queries (filters, populated
 * customer, per-exam/per-question aggregates). Result tables use qresult_*.
 */
export const adminExamRepository = {
  // ── exams ──────────────────────────────────────────────────────────────────
  listExams: (opts: { search?: string; categoryId?: number; type?: "subject" | "daily"; status?: boolean; isPaid?: boolean; skip: number; take: number }) => {
    const where = adminExamRepository.examListWhere(opts);
    return prisma.exam.findMany({
      where,
      include: { ExamCategory: { select: { id: true, name: true } }, ...examCategoriesInclude },
      // `order_by` is a legacy field with no correlation to recency (1487 rows
      // sit at 0, 2760 at 1, spanning the same 2018-2023 date range in both
      // buckets), so sorting by it first forced every `order_by=0` row ahead
      // of every `order_by=1` row regardless of actual creation date. Sort by
      // creation date only; `id desc` breaks ties deterministically.
      orderBy: [{ createAt: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    });
  },
  countExams: (opts: { search?: string; categoryId?: number; type?: "subject" | "daily"; status?: boolean; isPaid?: boolean }) =>
    prisma.exam.count({ where: adminExamRepository.examListWhere(opts) }),

  examListWhere: (opts: {
    search?: string;
    categoryId?: number;
    type?: "subject" | "daily";
    status?: boolean;
    isPaid?: boolean;
  }): Prisma.ExamWhereInput => {
    const parts: Prisma.ExamWhereInput[] = [];
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) parts.push(search);
    if (opts.categoryId !== undefined) parts.push(examInCategoryWhere(opts.categoryId));
    if (opts.type) parts.push({ type: opts.type });
    if (opts.status !== undefined) parts.push({ status: opts.status });
    if (opts.isPaid !== undefined) parts.push({ isPaid: opts.isPaid });
    return parts.length ? { AND: parts } : {};
  },
  findExam: (id: number) =>
    prisma.exam.findUnique({
      where: { id },
      include: { ExamCategory: { select: { id: true, name: true } }, ...examCategoriesInclude },
    }),
  countQuestionsForExam: (examId: number) => prisma.examQuestion.count({ where: { exam: examId } }),

  // ── exam writes ──────────────────────────────────────────────────────────────
  /** Minimal columns needed to merge an update / run the daily-overlap rule. */
  findExamMeta: (id: number) =>
    prisma.exam.findUnique({ where: { id }, select: { id: true, type: true, status: true, startAt: true, endAt: true, solution: true } }),
  /**
   * Another PUBLISHED daily test whose availability window overlaps [startAt,endAt).
   * Overlap = existing.startAt < candidate.endAt AND existing.endAt > candidate.startAt
   * (strict, so back-to-back windows don't clash). `excludeId` drops the row being edited.
   */
  findDailyOverlap: (opts: { startAt: Date; endAt: Date; excludeId?: number }) =>
    prisma.exam.findFirst({
      where: {
        type: "daily",
        status: true,
        startAt: { lt: opts.endAt },
        endAt: { gt: opts.startAt },
        ...(opts.excludeId != null ? { id: { not: opts.excludeId } } : {}),
      },
      select: { id: true, name: true, startAt: true, endAt: true },
    }),
  createExam: (data: Prisma.ExamUncheckedCreateInput) => prisma.exam.create({ data }),
  updateExam: (id: number, data: Prisma.ExamUncheckedUpdateInput) => prisma.exam.update({ where: { id }, data }),
  setExamStatus: (id: number, status: boolean) => prisma.exam.update({ where: { id }, data: { status, updatedAt: new Date() } }),
  setExamOrder: (id: number, order: number) => prisma.exam.update({ where: { id }, data: { order_by: order, updatedAt: new Date() } }),
  /** Cascade delete: result-details → results → options → questions → exam (FK-safe order). */
  deleteExamCascade: (id: number) =>
    prisma.$transaction([
      prisma.examResultDetail.deleteMany({ where: { examId: id } }),
      prisma.examResult.deleteMany({ where: { examId: id } }),
      prisma.examQuestionOption.deleteMany({ where: { ExamQuestion: { exam: id } } }),
      prisma.examQuestion.deleteMany({ where: { exam: id } }),
      prisma.exam.delete({ where: { id } }),
    ]),

  // ── questions ────────────────────────────────────────────────────────────────
  listQuestions: (opts: { examId?: number; search?: string; status?: boolean; skip: number; take: number }) => {
    const where: Prisma.ExamQuestionWhereInput = {};
    if (opts.examId !== undefined) where.exam = opts.examId;
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.examQuestion.findMany({ where, orderBy: [{ order_by: "asc" }, { createdAt: "asc" }], skip: opts.skip, take: opts.take });
  },
  countQuestions: (opts: { examId?: number; search?: string; status?: boolean }) => {
    const where: Prisma.ExamQuestionWhereInput = {};
    if (opts.examId !== undefined) where.exam = opts.examId;
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.examQuestion.count({ where });
  },
  findQuestion: (id: number) => prisma.examQuestion.findUnique({ where: { id } }),
  optionsForQuestions: (questionIds: number[]) =>
    prisma.examQuestionOption.findMany({ where: { question: { in: questionIds } }, orderBy: { id: "asc" } }),

  // ── question writes ────────────────────────────────────────────────────────
  examExists: (id: number) => prisma.exam.findUnique({ where: { id }, select: { id: true } }),
  maxQuestionOrder: async (examId: number): Promise<number> => {
    const top = await prisma.examQuestion.findFirst({ where: { exam: examId }, orderBy: { order_by: "desc" }, select: { order_by: true } });
    return top?.order_by ?? -1;
  },
  /** ws_exam_question_option has only title + question_id — option image/order are dropped (no columns). */
  createQuestion: (input: QuestionWrite) =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const q = await tx.examQuestion.create({ data: {
        exam: input.examId, name: input.name, answer: input.answer, image: input.image,
        solutionDescription: input.solutionText, solutionFile: input.solutionImage,
        order_by: input.orderBy, status: input.status, createdAt: now, updatedAt: now,
      } });
      if (input.options.length)
        await tx.examQuestionOption.createMany({ data: input.options.map((o) => ({ question: q.id, name: o.name, createdAt: now, updatedAt: now })) });
      await recomputeCount(tx, input.examId);
      const options = await tx.examQuestionOption.findMany({ where: { question: q.id }, orderBy: { id: "asc" } });
      return { q, options };
    }),
  bulkCreateQuestions: (examId: number, items: Array<QuestionWrite>) =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const out: any[] = [];
      for (const input of items) {
        const q = await tx.examQuestion.create({ data: {
          exam: examId, name: input.name, answer: input.answer, image: input.image,
          solutionDescription: input.solutionText, solutionFile: input.solutionImage,
          order_by: input.orderBy, status: input.status, createdAt: now, updatedAt: now,
        } });
        if (input.options.length)
          await tx.examQuestionOption.createMany({ data: input.options.map((o) => ({ question: q.id, name: o.name, createdAt: now, updatedAt: now })) });
        const options = await tx.examQuestionOption.findMany({ where: { question: q.id }, orderBy: { id: "asc" } });
        out.push({ q, options });
      }
      await recomputeCount(tx, examId);
      return out;
    }),
  updateQuestion: (id: number, examId: number, data: Prisma.ExamQuestionUncheckedUpdateInput, newOptions: { name: string }[] | null, recount: boolean) =>
    prisma.$transaction(async (tx) => {
      const q = await tx.examQuestion.update({ where: { id }, data });
      if (newOptions) {
        await tx.examQuestionOption.deleteMany({ where: { question: id } });
        const now = new Date();
        if (newOptions.length)
          await tx.examQuestionOption.createMany({ data: newOptions.map((o) => ({ question: id, name: o.name, createdAt: now, updatedAt: now })) });
      }
      if (recount) await recomputeCount(tx, examId);
      const options = await tx.examQuestionOption.findMany({ where: { question: id }, orderBy: { id: "asc" } });
      return { q, options };
    }),
  deleteQuestion: (id: number, examId: number) =>
    prisma.$transaction(async (tx) => {
      await tx.examResultDetail.deleteMany({ where: { questionId: id } });
      await tx.examQuestionOption.deleteMany({ where: { question: id } });
      await tx.examQuestion.delete({ where: { id } });
      await recomputeCount(tx, examId);
    }),
  setQuestionOrder: (id: number, order: number) =>
    prisma.examQuestion.update({ where: { id }, data: { order_by: order, updatedAt: new Date() } }),

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
