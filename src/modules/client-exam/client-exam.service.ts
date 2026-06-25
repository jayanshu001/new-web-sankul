import { isMysqlModule } from "../../config/migration";
import { clientExamRepository as repo } from "./client-exam.repository";

export const CLIENT_EXAM_MODULE = "client-exam";
export const isClientExamMysql = (): boolean => isMysqlModule(CLIENT_EXAM_MODULE);

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
export const listExamsByCategory = async (categoryId: number, customerId: number | null) => {
  const now = new Date();
  const [subjects, exams] = await Promise.all([
    repo.subCategories(categoryId),
    repo.examsByCategory(categoryId, now),
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

  return { subjects: subjects.map(toCategoryDto), exams: decorated, completedTests };
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
  const [exams, total] = await Promise.all([
    repo.examsByCategoryPaged(categoryId, now, opts.search ?? null, opts.skip, opts.take),
    repo.countExamsByCategoryPaged(categoryId, now, opts.search ?? null),
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

// ─── listMyResults ────────────────────────────────────────────────────────────
export const listMyResults = async (customerId: number, page: number, limit: number) => {
  const [rows, total] = await Promise.all([
    repo.myResults(customerId, (page - 1) * limit, limit),
    repo.countMyResults(customerId),
  ]);
  const items = rows.map((r: any) => ({
    ...toResultDto(r),
    exam: r.Exam ? { _id: String(r.Exam.id), title: r.Exam.name } : null,
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

export const getDailyExams = async (opts: { year?: number; month?: number; week?: number; customerId: number | null }) => {
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
  // Level 4: tests in the week, decorated per-customer
  const { start, end } = weekRange(opts.year, opts.month, opts.week);
  const exams = await repo.dailyInWindow(start, end);
  const resultByExam = new Map<string, any>();
  if (opts.customerId && exams.length) {
    const results = await repo.resultsForCustomerExams(opts.customerId, exams.map((e) => e.id));
    for (const r of results) { const k = String(r.examId); if (!resultByExam.has(k)) resultByExam.set(k, toResultDto(r)); }
  }
  const data = exams.map((e) => {
    const dto = toExamDto(e);
    return { ...dto, isCompleted: resultByExam.has(dto._id), lastResult: resultByExam.get(dto._id) ?? null };
  });
  return { level: "tests", data };
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
  const best = await repo.bestScoresForExam(data.examId);
  const myBest = best.find((b) => Number(b.customerId) === customerId)?.best ?? result.score;
  const myBestNum = num(myBest);
  const higher = best.filter((b) => num(b.best) > myBestNum).length;
  const rank = `${higher + 1}/${best.length}`;

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
      return { _id: String(q.id), title: q.name, image: q.image ?? null, answers, result: d.result, point: num(d.point) };
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

export { toExamDto, toResultDto };
