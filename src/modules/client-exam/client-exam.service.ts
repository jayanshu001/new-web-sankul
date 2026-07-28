import { clientExamRepository as repo } from "./client-exam.repository";
import { descendantExamCategoryIds } from "../catalog-exam/exam-category-pivot.where";

export const CLIENT_EXAM_MODULE = "client-exam";
export const isClientExamMysql = (): boolean => true;

export const parseExamId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Exam → the Mongo-shaped client DTO (matches the controller's .select fields).
const toExamDto = (e: any) => ({
  _id: String(e.id),
  title: e.name,
  type: e.type,
  isPaid: e.isPaid,
  durationMinutes: e.time,
  questionCount: e.numberOfQuestions,
  positiveMarks: num(e.positiveMarks),
  negativeMarks: num(e.negativeMarks),
  startAt: e.startAt ?? null,
  endAt: e.endAt ?? null,
  orderBy: e.order_by,
  createdAt: e.createAt ?? null,
});

const toResultDto = (r: any) => ({
  _id: String(r.id),
  examId: r.examId != null ? String(r.examId) : null,
  // FE reads attemptNumber/inProgress on my-attempts, daily lastResult and the
  // solution analytics header (confirmed by RN client) — keep them on the DTO.
  attemptNumber: r.attemptNumber ?? null,
  inProgress: r.inProgress ?? false,
  total: r.total,
  attempt: r.attempt,
  skip: r.skip,
  success: r.success,
  failed: r.failed,
  score: num(r.score),
  timing: r.timing,
  ratting: r.ratting ?? null,
  createdAt: r.created_at ?? null,
});

const toCategoryDto = (c: any) => ({
  _id: String(c.id),
  name: c.name ?? null,
  image: c.image ?? null,
  orderBy: c.order_by,
});

// ─── listExamsByCategory ──────────────────────────────────────────────────────
// `subjects` and `completedTests` are whole-category summaries, so they are
// computed over the FULL (search-filtered) exam set; only `exams` is windowed.
// The list is sliced in JS (rather than pushing skip/take into Prisma) so the
// two summaries keep their original, page-independent semantics. `total` is the
// full filtered count for the pagination envelope.
export const listExamsByCategory = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip?: number; take?: number; search?: string | null } = {}
) => {
  const now = new Date();
  const categoryIds = await descendantExamCategoryIds(categoryId);
  const [subjects, exams] = await Promise.all([
    repo.subCategories(categoryId),
    repo.examsByCategory(categoryIds, now, opts.search ?? null),
  ]);

  const resultByExam = new Map<string, any>();
  if (customerId && exams.length) {
    const results = await repo.resultsForCustomerExams(customerId, exams.map((e) => e.id));
    for (const r of results) {
      const k = String(r.examId);
      if (!resultByExam.has(k)) resultByExam.set(k, toResultDto(r));
    }
  }

  const decorated = exams.map((e) => {
    const dto = toExamDto(e);
    return { ...dto, isCompleted: resultByExam.has(dto._id), lastResult: resultByExam.get(dto._id) ?? null };
  });
  const completedTests = decorated.filter((e) => e.type === "subject" && e.isCompleted);

  const total = decorated.length;
  const skip = opts.skip ?? 0;
  const take = opts.take ?? decorated.length;
  const pagedExams = decorated.slice(skip, skip + take);

  return { subjects: subjects.map(toCategoryDto), exams: pagedExams, completedTests, total };
};

// ─── listExamsByCategoryPaged ─────────────────────────────────────────────────
// Paginated variant for GET /client/exam-categories/:id/exams — returns the
// category header + decorated exam list + total (Mongo parity: status published,
// non-daily, optional title search). Each row carries isCompleted + lastResult.
export const listExamsByCategoryPaged = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip: number; take: number; search?: string | null }
) => {
  const category = await repo.findCategory(categoryId);
  if (!category) return null;

  const now = new Date();
  const categoryIds = await descendantExamCategoryIds(categoryId);
  const [exams, total] = await Promise.all([
    repo.examsByCategoryPaged(categoryIds, now, opts.search ?? null, opts.skip, opts.take),
    repo.countExamsByCategoryPaged(categoryIds, now, opts.search ?? null),
  ]);

  const resultByExam = new Map<string, any>();
  if (customerId && exams.length) {
    const results = await repo.resultsForCustomerExams(customerId, exams.map((e) => e.id));
    for (const r of results) {
      const k = String(r.examId);
      if (!resultByExam.has(k)) resultByExam.set(k, toResultDto(r));
    }
  }

  const list = exams.map((e) => {
    const dto = toExamDto(e);
    return { ...dto, isCompleted: resultByExam.has(dto._id), lastResult: resultByExam.get(dto._id) ?? null };
  });

  return { category: toCategoryDto(category), list, total };
};

// ─── getExamQuestions ─────────────────────────────────────────────────────────
export const getExamQuestions = async (examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  if (!exam) return null;
  const questions = await repo.questionsForExam(examId);
  const opts = questions.length ? await repo.optionsForQuestions(questions.map((q) => q.id)) : [];
  const byQ: Record<string, any[]> = {};
  for (const o of opts) {
    (byQ[String(o.question)] ||= []).push({ _id: String(o.id), name: o.name, image: null, isSelect: false });
  }
  const decorated = questions.map((q) => ({
    _id: String(q.id),
    title: q.name,
    image: q.image ?? null,
    orderBy: q.order_by,
    answers: byQ[String(q.id)] || [],
  }));
  return { exam: toExamDto(exam), questions: decorated };
};

// ─── getExamDetail (meta only) ───────────────────────────────────────────────
export const getExamDetail = async (examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  return exam ? toExamDto(exam) : null;
};

// ─── listMyResults ────────────────────────────────────────────────────────────
export const listMyResults = async (customerId: number, page: number, limit: number, search?: string | null) => {
  const [rows, total] = await Promise.all([
    repo.myResults(customerId, (page - 1) * limit, limit, search ?? null),
    repo.countMyResults(customerId, search ?? null),
  ]);
  const items = rows.map((r: any) => ({
    ...toResultDto(r),
    exam: r.Exam ? { _id: String(r.Exam.id), title: r.Exam.name } : null,
  }));
  return { items, total };
};

// Full ExamResult → Mongo-document-shaped DTO (mirrors models/exam/ExamResult.model).
const toFullResultDto = (r: any) => ({
  _id: String(r.id),
  customerId: r.customerId != null ? String(r.customerId) : null,
  examId: r.examId != null ? String(r.examId) : null,
  attemptNumber: r.attemptNumber ?? null,
  total: r.total,
  attempt: r.attempt,
  skip: r.skip,
  success: r.success,
  failed: r.failed,
  score: num(r.score),
  timing: r.timing,
  ratting: r.ratting ?? null,
  solution: r.solution ?? null,
  status: r.status ?? null,
  inProgress: r.inProgress ?? null,
  startedAt: r.startedAt ?? null,
  submittedAt: r.submittedAt ?? null,
  createdAt: r.created_at ?? null,
});

// ─── getMyOverallAnalytics ────────────────────────────────────────────────────
export const getOverallAnalytics = async (customerId: number) => {
  const row = await repo.overallAnalytics(customerId);
  if (!row) return null;
  return {
    _id: String(row.id),
    customerId: row.customerId != null ? String(row.customerId) : null,
    exams: row.exams,
    questions: row.questions,
    attempt: row.attempt,
    skip: row.skip,
    success: row.success,
    failed: row.failed,
    score: num(row.score),
  };
};

// ─── rateExamResult ───────────────────────────────────────────────────────────
export const rateResult = async (customerId: number, examId: number, ratting: string) => {
  const existing = await repo.findResultByExam(customerId, examId);
  if (!existing) return null;
  const updated = await repo.rateResult(existing.id, ratting);
  return toFullResultDto(updated);
};

// ─── listMyPastDailyResults ───────────────────────────────────────────────────
export const listPastDailyResults = async (customerId: number, page: number, limit: number, search?: string | null) => {
  const [rows, total] = await Promise.all([
    repo.pastDailyResults(customerId, (page - 1) * limit, limit, search ?? null),
    repo.countPastDailyResults(customerId, search ?? null),
  ]);
  const items = rows.map((r: any) => ({
    _id: String(r.id),
    attemptNumber: r.attemptNumber ?? null,
    total: r.total,
    attempt: r.attempt,
    skip: r.skip,
    success: r.success,
    failed: r.failed,
    score: num(r.score),
    timing: r.timing,
    submittedAt: r.submittedAt ?? null,
    createdAt: r.created_at ?? null,
    exam: r.Exam
      ? {
          _id: String(r.Exam.id),
          title: r.Exam.name,
          type: r.Exam.type,
          durationMinutes: r.Exam.time,
          positiveMarks: num(r.Exam.positiveMarks),
          negativeMarks: num(r.Exam.negativeMarks),
          startAt: r.Exam.startAt ?? null,
        }
      : null,
  }));
  return { items, total };
};

// ─── solutions (the exam's solution PDF + per-exam result) ───────────────────
export const getExamForSolution = async (examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  return exam ? toExamDto({ ...exam, solution: exam.solution }) : null;
};

export const getResultForExam = async (examId: number, customerId: number) => {
  const rows = await repo.resultsForCustomerExams(customerId, [examId]);
  return rows.length ? toResultDto(rows[0]) : null;
};

// ─── daily-exam drill-down ───────────────────────────────────────────────────
const MONTH_LABELS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const weekOfMonth = (day: number) => (day <= 28 ? Math.ceil(day / 7) : 5);
const weekRange = (year: number, month: number, week: number) => {
  const startDay = (week - 1) * 7 + 1;
  const start = new Date(year, month - 1, startDay, 0, 0, 0, 0);
  const end = week === 5 ? new Date(year, month, 0, 23, 59, 59, 999) : new Date(year, month - 1, startDay + 6, 23, 59, 59, 999);
  return { start, end };
};

export const getDailyExams = async (opts: { year?: number; month?: number; week?: number; customerId: number | null; skip?: number; take?: number; search?: string | null }) => {
  const now = new Date();
  // Level 1: years
  if (!opts.year) {
    const rows = await repo.dailyYears(now);
    return { level: "years", data: rows.map((r) => ({ year: num(r.year), testsCount: num(r.testsCount) })) };
  }
  // Level 2: months
  if (!opts.month) {
    const rows = await repo.dailyMonths(opts.year);
    return { level: "months", data: rows.map((r) => ({ year: opts.year, month: num(r.month), label: MONTH_LABELS[num(r.month) - 1], testsCount: num(r.testsCount) })) };
  }
  // Level 3: weeks (derived in JS from the month's exams)
  if (!opts.week) {
    const from = new Date(opts.year, opts.month - 1, 1, 0, 0, 0, 0);
    const to = new Date(opts.year, opts.month, 0, 23, 59, 59, 999);
    const exams = await repo.dailyInWindow(from, to);
    const counts = new Map<number, number>();
    for (const e of exams) {
      const d = (e.startAt ?? e.createAt) as Date | null;
      if (!d) continue;
      const w = weekOfMonth(new Date(d).getDate());
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const data = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]).map(([week, testsCount]) => {
      const { start, end } = weekRange(opts.year!, opts.month!, week);
      return { week, label: `Week ${week}`, startDate: start, endDate: end, testsCount };
    });
    return { level: "weeks", data };
  }
  // Level 4: tests in the week, decorated per-customer (paginated + name search)
  const { start, end } = weekRange(opts.year, opts.month, opts.week);
  const search = opts.search ?? null;
  const skip = opts.skip ?? 0;
  const take = opts.take ?? 20;
  const [exams, total] = await Promise.all([
    repo.dailyInWindowPaged(start, end, search, skip, take),
    repo.countDailyInWindow(start, end, search),
  ]);
  const resultByExam = new Map<string, any>();
  if (opts.customerId && exams.length) {
    const results = await repo.resultsForCustomerExams(opts.customerId, exams.map((e) => e.id));
    for (const r of results) { const k = String(r.examId); if (!resultByExam.has(k)) resultByExam.set(k, toResultDto(r)); }
  }
  const data = exams.map((e) => {
    const dto = toExamDto(e);
    return { ...dto, isCompleted: resultByExam.has(dto._id), lastResult: resultByExam.get(dto._id) ?? null };
  });
  return { level: "tests", data, total };
};

// ─── saveAnswers (scoring WRITE) ──────────────────────────────────────────────
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface SaveAnswersInput {
  examId: number;
  timing: string;
  ratting?: string | null;
  test: Array<{ questionId: number; answerId: number }>;
}

export type SaveAnswersResult =
  | { ok: false; status: number; message: string }
  | { ok: true; examResult: any; rank: string };

export const saveAnswers = async (customerId: number, data: SaveAnswersInput): Promise<SaveAnswersResult> => {
  const exam = await repo.findExam(data.examId);
  if (!exam) return { ok: false, status: 404, message: "Exam is not found." };
  if (exam.numberOfQuestions !== data.test.length) {
    return { ok: false, status: 400, message: "Exam's total questions are not match with your total answers." };
  }

  const posMarks = num(exam.positiveMarks);
  const negMarks = num(exam.negativeMarks);
  const details: Array<{ questionId: number; answerId: number; result: "true" | "false" | "skip"; point: number }> = [];

  for (const item of data.test) {
    const question = await repo.findQuestion(item.questionId, data.examId);
    if (!question) return { ok: false, status: 400, message: "Sorry, Question are not match with their exam." };
    const option = await repo.findOption(item.answerId, item.questionId);
    if (!option) return { ok: false, status: 400, message: "Sorry, Answer is not match with their exam and question." };

    let result: "true" | "false" | "skip";
    if (norm(option.name) === "skip") result = "skip";
    else if (norm(option.name) === norm(question.answer)) result = "true";
    else result = "false";

    const point = result === "skip" ? 0 : result === "true" ? posMarks : -Math.abs(negMarks);
    details.push({ questionId: item.questionId, answerId: item.answerId, result, point });
  }

  const total = details.length;
  let skip = 0, success = 0, failed = 0, score = 0;
  for (const d of details) {
    if (d.result === "skip") skip += 1;
    else if (d.result === "true") success += 1;
    else failed += 1;
    score += d.point;
  }
  const attempt = total - skip;

  const result = await repo.createResult({
    customerId, examId: data.examId, total, attempt, skip, success, failed,
    score: Math.round(score * 100) / 100, timing: data.timing, ratting: data.ratting ?? null, details,
  });

  await repo.recomputeAnalytics(customerId);

  // Rank by best score per customer (ties share a rank; higher = better).
  // Counted in SQL — see repo.rankForExam.
  const myBest = Math.max(
    num(result.score),
    await repo.myBestScoreForExam(customerId, data.examId)
  );
  const { higher, candidates } = await repo.rankForExam(data.examId, myBest);
  const rank = `${higher + 1}/${candidates}`;

  return { ok: true, examResult: toResultDto(result), rank };
};

// ─── Solution view ────────────────────────────────────────────────────────────
export const getSolution = async (customerId: number, examId: number, attemptId?: number) => {
  const target = attemptId
    ? await repo.findResultById(attemptId, customerId, examId)
    : await repo.latestResultForExam(customerId, examId);
  if (!target) return null;

  const details = await repo.detailsForResult(target.id);
  const qIds = details.map((d) => d.questionId).filter((x): x is number => x != null);
  const questions = qIds.length ? await repo.questionsByIds(qIds) : [];
  const qById = new Map(questions.map((q) => [q.id, q]));
  const opts = qIds.length ? await repo.optionsForQuestions(qIds) : [];
  const optsByQ: Record<string, any[]> = {};
  for (const o of opts) (optsByQ[String(o.question)] ||= []).push(o);

  return details
    .filter((d) => d.questionId != null && qById.has(d.questionId))
    .map((d) => {
      const q = qById.get(d.questionId!)!;
      const answers = (optsByQ[String(q.id)] || []).map((o) => ({
        _id: String(o.id),
        name: o.name,
        image: null,
        isSelect: d.answerId === o.id,
        isCorrect: norm(q.answer) === norm(o.name),
      }));
      // solutionText = ws_exam_question.solution_text (HTML explanation shown on
      // TestResultScreen). solution_image stays dropped — FE does not read it.
      return { _id: String(q.id), title: q.name, image: q.image ?? null, solutionText: q.solutionDescription ?? null, answers, result: d.result, point: num(d.point) };
    });
};

export const getSolutionAnalytics = async (customerId: number, examId: number, attemptId?: number) => {
  const r = attemptId
    ? await repo.findResultById(attemptId, customerId, examId)
    : await repo.latestResultForExam(customerId, examId);
  if (!r) return null;
  const accuracy = r.total > 0 ? (r.success * 100) / r.total : 0;
  return {
    ...toResultDto(r),
    accuracy: Math.round(accuracy * 100) / 100,
  };
};

// ─── attempt lifecycle (resumable attempts) ──────────────────────────────────
// SQL port of the Mongo attempt flow in client/exam/exam.controller.ts. An
// in-progress attempt is a ws_exam_result row with status=false/inProgress=true;
// submit flips it to status=true. Scoring mirrors saveAnswers above.
const toAttemptDto = (r: any) => ({
  _id: String(r.id),
  examId: r.examId != null ? String(r.examId) : null,
  attemptNumber: r.attemptNumber ?? null,
  total: r.total,
  attempt: r.attempt,
  skip: r.skip,
  success: r.success,
  failed: r.failed,
  score: num(r.score),
  timing: r.timing,
  ratting: r.ratting ?? null,
  status: r.status ?? false,
  inProgress: r.inProgress ?? false,
  startedAt: r.startedAt ?? null,
  submittedAt: r.submittedAt ?? null,
  createdAt: r.created_at ?? null,
});

const attemptExpired = (startedAt: Date | null | undefined, durationMinutes: number) => {
  if (!startedAt) return false;
  return Date.now() > new Date(startedAt).getTime() + durationMinutes * 60_000;
};

const computeTimingFromStart = (startedAt: Date | null | undefined): string => {
  if (!startedAt) return "00:00";
  const totalSec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
};

export const startAttempt = async (customerId: number, examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found or not published." };
  const now = new Date();
  // Only scheduled exams have a real start window; `subject` exams are treated
  // as always-available everywhere else (catalog/questions/saveAnswers), so the
  // "not started yet" gate must not apply to them.
  if (exam.type !== "subject" && exam.startAt && now < new Date(exam.startAt)) {
    return { ok: false as const, status: 400, message: "Exam has not started yet." };
  }
  const inProgress = await repo.findInProgressAttempt(customerId, examId);
  const attempt =
    inProgress ??
    (await repo.createInProgressAttempt({
      customerId,
      examId,
      attemptNumber: (await repo.maxAttemptNumber(customerId, examId)) + 1,
      startedAt: now,
    }));
  return {
    ok: true as const,
    data: {
      attemptId: String(attempt.id),
      attemptNumber: attempt.attemptNumber ?? null,
      startedAt: attempt.startedAt ?? null,
      serverNow: now,
      durationMinutes: exam.time,
      questionCount: exam.numberOfQuestions,
    },
  };
};

export const getActiveAttempt = async (customerId: number, examId: number) => {
  const exam = await repo.findExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found." };
  const attempt = await repo.findInProgressAttempt(customerId, examId);
  if (!attempt) return { ok: true as const, data: null };
  const details = await repo.detailsForResult(attempt.id);
  return {
    ok: true as const,
    data: {
      attemptId: String(attempt.id),
      attemptNumber: attempt.attemptNumber ?? null,
      startedAt: attempt.startedAt ?? null,
      serverNow: new Date(),
      durationMinutes: exam.time,
      expired: attemptExpired(attempt.startedAt, exam.time),
      savedAnswers: details.map((d) => ({
        questionId: d.questionId != null ? String(d.questionId) : null,
        answerId: d.answerId != null ? String(d.answerId) : null,
      })),
    },
  };
};

export const saveSingleAnswer = async (
  customerId: number,
  examId: number,
  attemptId: number,
  input: { questionId: number; answerId: number | null }
) => {
  const attempt = await repo.findAttempt(attemptId, customerId, examId);
  if (!attempt) return { ok: false as const, status: 404, message: "Attempt not found." };
  if (attempt.status === true) return { ok: false as const, status: 400, message: "Attempt already submitted." };
  const exam = await repo.findExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found." };
  if (attemptExpired(attempt.startedAt, exam.time)) {
    return { ok: false as const, status: 400, message: "Attempt has expired. Please submit." };
  }

  const question = await repo.findQuestion(input.questionId, examId);
  if (!question) return { ok: false as const, status: 400, message: "Question does not belong to exam." };

  let result: "true" | "false" | "skip";
  let point = 0;
  let answerId: number | null = null;
  if (!input.answerId) {
    result = "skip";
  } else {
    const option = await repo.findOption(input.answerId, input.questionId);
    if (!option) return { ok: false as const, status: 400, message: "Answer does not belong to question." };
    answerId = option.id;
    if (norm(option.name) === "skip") result = "skip";
    else if (norm(option.name) === norm(question.answer)) { result = "true"; point = num(exam.positiveMarks); }
    else { result = "false"; point = -Math.abs(num(exam.negativeMarks)); }
  }

  await repo.upsertAttemptDetail({ examResultId: attempt.id, customerId, examId, questionId: input.questionId, answerId, result, point });
  return { ok: true as const, data: { saved: true } };
};

export const submitAttempt = async (
  customerId: number,
  examId: number,
  attemptId: number,
  input: { timing?: string; ratting?: string | null }
) => {
  const attempt = await repo.findAttempt(attemptId, customerId, examId);
  if (!attempt) return { ok: false as const, status: 404, message: "Attempt not found." };
  if (attempt.status === true) return { ok: false as const, status: 400, message: "Attempt already submitted." };
  const exam = await repo.findExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found." };

  const allQIds = (await repo.questionIdsForExam(examId)).map((q) => q.id);
  const total = allQIds.length;

  const saved = await repo.detailsForResult(attempt.id);
  const savedByQ = new Map<number, any>();
  for (const d of saved) if (d.questionId != null) savedByQ.set(d.questionId, d);

  let skip = 0, success = 0, failed = 0, score = 0;
  const missing: number[] = [];
  for (const qid of allQIds) {
    const ex = savedByQ.get(qid);
    if (!ex) { missing.push(qid); skip += 1; }
    else {
      if (ex.result === "skip") skip += 1;
      else if (ex.result === "true") success += 1;
      else failed += 1;
      score += num(ex.point);
    }
  }

  const submittedAt = new Date();
  const timing = input.timing ?? computeTimingFromStart(attempt.startedAt);
  const updated = await repo.finalizeAttempt({
    attemptId: attempt.id, customerId, examId, missingQuestionIds: missing,
    total, attempt: total - skip, skip, success, failed,
    score: Math.round(score * 100) / 100, timing, ratting: input.ratting ?? attempt.ratting ?? null, submittedAt,
  });

  await repo.recomputeAnalytics(customerId);

  const myBest = Math.max(
    num(updated.score),
    await repo.myBestScoreForExam(customerId, examId)
  );
  const { higher, candidates } = await repo.rankForExam(examId, myBest);
  const rank = `${higher + 1}/${candidates}`;

  return { ok: true as const, data: { examResult: toAttemptDto(updated), rank } };
};

export const listAttempts = async (
  customerId: number,
  examId: number,
  opts: { skip?: number; take?: number } = {}
) => {
  const exam = await repo.findExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found." };
  const [attempts, total] = await Promise.all([
    repo.attemptsForExam(customerId, examId, opts.skip, opts.take),
    repo.countAttemptsForExam(customerId, examId),
  ]);
  return {
    ok: true as const,
    total,
    data: {
      exam: { _id: String(exam.id), title: exam.name, type: exam.type, durationMinutes: exam.time },
      attempts: attempts.map(toAttemptDto),
    },
  };
};

export const getAttemptsAggregate = async (customerId: number, examId: number) => {
  const exam = await repo.findExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found." };
  const agg = await repo.aggregateForExam(customerId, examId);
  const attemptsCount = agg._count._all;
  const total = num(agg._sum.total), attempt = num(agg._sum.attempt), skip = num(agg._sum.skip);
  const success = num(agg._sum.success), failed = num(agg._sum.failed);
  const scoreSum = Math.round(num(agg._sum.score) * 100) / 100;
  const bestScore = Math.round(num(agg._max.score) * 100) / 100;
  const summary = {
    attemptsCount, total, attempt, skip, success, failed, scoreSum, bestScore,
    avgScore: attemptsCount > 0 ? Math.round((scoreSum / attemptsCount) * 100) / 100 : 0,
    accuracy: total > 0 ? Math.round((success / total) * 100 * 100) / 100 : 0,
    lastSubmittedAt: agg._max.submittedAt ?? null,
  };
  const myBest = await repo.myBestScoreForExam(customerId, examId);
  const { higher, candidates: totalCandidates } = await repo.rankForExam(examId, myBest);
  return {
    ok: true as const,
    data: {
      exam: { _id: String(exam.id), title: exam.name, questionCount: exam.numberOfQuestions },
      summary,
      rank: totalCandidates > 0 ? `${higher + 1}/${totalCandidates}` : "-",
    },
  };
};

export { toExamDto, toResultDto };
