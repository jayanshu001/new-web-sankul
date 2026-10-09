// Client exams: listings, attempt lifecycle, results, solutions and daily tests.
import { clientExamRepository as repo } from "./client-exam.repository";
import { descendantExamCategoryIds } from "../catalog-exam/exam-category-pivot.where";
import { MONTH_LABELS, weekOfMonth, weekRange } from "../../utils/dateBuckets";
import { parsePositiveInt } from "../../utils/parseId";

export const parseExamId = parsePositiveInt;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Legacy attempts stored timing as "3 Minutes : 31 Seconds"; the current flow
 * writes "MM:SS" (see computeTimingFromStart). Every read normalises to "MM:SS"
 * so the app parses one format.
 */
export const normalizeTiming = (t: string | null | undefined): string | null => {
  if (t == null) return null;
  const m = /^\s*(\d+)\s*Minutes?\s*:\s*(\d+)\s*Seconds?\s*$/i.exec(t);
  return m ? `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}` : t;
};

/** Detail rows of one attempt, falling back to the legacy (customer, exam) link. */
export const detailsForAttempt = async (r: { id: number; customerId: number | null; examId: number | null }) => {
  const details = await repo.detailsForResult(r.id);
  if (details.length || r.customerId == null || r.examId == null) return details;
  return repo.legacyDetailsForExam(r.customerId, r.examId);
};

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
  // The RN client reads attemptNumber/inProgress on my-attempts, daily lastResult
  // and the solution analytics header.
  attemptNumber: r.attemptNumber ?? null,
  inProgress: r.inProgress ?? false,
  total: r.total,
  attempt: r.attempt,
  skip: r.skip,
  success: r.success,
  failed: r.failed,
  score: num(r.score),
  timing: normalizeTiming(r.timing),
  ratting: r.ratting ?? null,
  createdAt: r.created_at ?? null,
});

const toCategoryDto = (c: any) => ({
  _id: String(c.id),
  name: c.name ?? null,
  image: c.image ?? null,
  orderBy: c.order_by,
});

// `subjects` and `completedTests` summarise the full (search-filtered) exam set, so
// only `exams` is sliced (in JS) to the page; `total` is the full filtered count.
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

// Status published, non-daily, optional title search.
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

export const getExamQuestions = async (examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  if (!exam) return null;
  const questions = await repo.questionsForExam(examId);
  const opts = questions.length ? await repo.optionsForQuestions(questions.map((q) => q.id)) : [];
  const byQ: Record<string, any[]> = {};
  for (const o of opts) {
    // Legacy "Skip" options are no longer choices (clients send `answerId: null`);
    // the rows stay because historical results reference them, and are still
    // accepted on submit.
    if (isLegacySkipOptionName(o.name)) continue;
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

export const getExamDetail = async (examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  return exam ? toExamDto(exam) : null;
};

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
  timing: normalizeTiming(r.timing),
  ratting: r.ratting ?? null,
  solution: r.solution ?? null,
  status: r.status ?? null,
  inProgress: r.inProgress ?? null,
  startedAt: r.startedAt ?? null,
  submittedAt: r.submittedAt ?? null,
  createdAt: r.created_at ?? null,
});

export const getOverallAnalytics = async (customerId: number) => {
  const row = await repo.overallAnalytics(customerId);
  // No submitted attempt means no analytics.
  if (!row.exams) return null;
  return {
    // `_id` is kept for the frozen shape; one per customer.
    _id: String(customerId),
    customerId: String(customerId),
    exams: row.exams,
    questions: row.questions,
    attempt: row.attempt,
    skip: row.skip,
    success: row.success,
    failed: row.failed,
    score: num(row.score),
  };
};

export const rateResult = async (customerId: number, examId: number, ratting: string) => {
  const existing = await repo.findResultByExam(customerId, examId);
  if (!existing) return null;
  const updated = await repo.rateResult(existing.id, ratting);
  return toFullResultDto(updated);
};

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
    timing: normalizeTiming(r.timing),
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

// Bucketing helpers are shared with the free-tests drill-down (utils/dateBuckets).

export const getDailyExams = async (opts: { year?: number; month?: number; week?: number; customerId: number | null; skip?: number; take?: number; search?: string | null }) => {
  const now = new Date();
  if (!opts.year) {
    const rows = await repo.dailyYears(now);
    return { level: "years", data: rows.map((r) => ({ year: num(r.year), testsCount: num(r.testsCount) })) };
  }
  if (!opts.month) {
    const rows = await repo.dailyMonths(opts.year);
    return { level: "months", data: rows.map((r) => ({ year: opts.year, month: num(r.month), label: MONTH_LABELS[num(r.month) - 1], testsCount: num(r.testsCount) })) };
  }
  // Weeks are derived in JS from the month's exams.
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

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Skip has two representations: legacy rows point answer_id at an option named
 * "Skip"; current clients send `answerId: null`. Both are accepted on write, and
 * reads normalise the legacy form (see `selectedOptionId`). Legacy option rows are
 * never deleted because historical result details reference them.
 *
 * `result` ('true' | 'false' | 'skip') is canonical for both forms; count skips
 * from it, never from the answer id.
 */
export const isLegacySkipOptionName = (name: string | null | undefined): boolean => norm(name) === "skip";

/** The chosen option, with a legacy "Skip" selection collapsed to null (what a new-style skip stores). */
const selectedOptionId = (answerId: number | null | undefined, skipOptionIds: Set<number>): number | null =>
  answerId == null || skipOptionIds.has(answerId) ? null : answerId;

export interface SaveAnswersInput {
  examId: number;
  timing: string;
  ratting?: string | null;
  // `answerId: null` means skipped; a legacy "Skip" option id is still accepted.
  test: Array<{ questionId: number; answerId: number | null }>;
}

export type SaveAnswersResult =
  | { ok: false; status: number; message: string }
  | { ok: true; examResult: any; rank: string };

// One-shot submit of a full answer sheet; returns the result and rank.
export const saveAnswers = async (customerId: number, data: SaveAnswersInput): Promise<SaveAnswersResult> => {
  const exam = await repo.findExam(data.examId);
  if (!exam) return { ok: false, status: 404, message: "Exam is not found." };
  if (exam.numberOfQuestions !== data.test.length) {
    return { ok: false, status: 400, message: "Exam's total questions are not match with your total answers." };
  }

  const posMarks = num(exam.positiveMarks);
  const negMarks = num(exam.negativeMarks);
  const details: Array<{ questionId: number; answerId: number | null; result: "true" | "false" | "skip"; point: number }> = [];

  for (const item of data.test) {
    const question = await repo.findQuestion(item.questionId, data.examId);
    if (!question) return { ok: false, status: 400, message: "Sorry, Question are not match with their exam." };

    // No answer id means skipped.
    if (!item.answerId) {
      details.push({ questionId: item.questionId, answerId: null, result: "skip", point: 0 });
      continue;
    }

    const option = await repo.findOption(item.answerId, item.questionId);
    if (!option) return { ok: false, status: 400, message: "Sorry, Answer is not match with their exam and question." };

    let result: "true" | "false" | "skip";
    // Older builds may still select the legacy "Skip" option row.
    if (isLegacySkipOptionName(option.name)) result = "skip";
    else if (norm(option.name) === norm(question.answer)) result = "true";
    else result = "false";

    const point = result === "skip" ? 0 : result === "true" ? posMarks : -Math.abs(negMarks);
    // A legacy skip is persisted as a new-style skip (answer_id NULL).
    details.push({ questionId: item.questionId, answerId: result === "skip" ? null : item.answerId, result, point });
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

  // Rank by best score per customer; ties share a rank.
  const myBest = Math.max(
    num(result.score),
    await repo.myBestScoreForExam(customerId, data.examId)
  );
  const { higher, candidates } = await repo.rankForExam(data.examId, myBest);
  const rank = `${higher + 1}/${candidates}`;

  return { ok: true, examResult: toResultDto(result), rank };
};

export const getSolution = async (customerId: number, examId: number, attemptId?: number) => {
  const target = attemptId
    ? await repo.findResultById(attemptId, customerId, examId)
    : await repo.latestResultForExam(customerId, examId);
  if (!target) return null;

  const details = await detailsForAttempt(target);
  const qIds = details.map((d) => d.questionId).filter((x): x is number => x != null);
  const questions = qIds.length ? await repo.questionsByIds(qIds) : [];
  const qById = new Map(questions.map((q) => [q.id, q]));
  const opts = qIds.length ? await repo.optionsForQuestions(qIds) : [];
  const optsByQ: Record<string, any[]> = {};
  // Legacy "Skip" options are hidden from `answers[]` and collected so a
  // pre-cutover attempt that selected one reads back as nothing selected.
  const skipOptionIds = new Set<number>();
  for (const o of opts) {
    if (isLegacySkipOptionName(o.name)) { skipOptionIds.add(o.id); continue; }
    (optsByQ[String(o.question)] ||= []).push(o);
  }

  return details
    .filter((d) => d.questionId != null && qById.has(d.questionId))
    .map((d) => {
      const q = qById.get(d.questionId!)!;
      const selected = selectedOptionId(d.answerId, skipOptionIds);
      const answers = (optsByQ[String(q.id)] || []).map((o) => ({
        _id: String(o.id),
        name: o.name,
        image: null,
        isSelect: selected === o.id,
        isCorrect: norm(q.answer) === norm(o.name),
      }));
      // solution_image is deliberately not emitted; the FE does not read it.
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

// An in-progress attempt is a ws_exam_result row with status=false/inProgress=true;
// submit flips it to status=true. Scoring mirrors saveAnswers.
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
  timing: normalizeTiming(r.timing),
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

// Resumes the in-progress attempt or opens the next numbered one.
export const startAttempt = async (customerId: number, examId: number) => {
  const exam = await repo.findPublishedExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found or not published." };
  const now = new Date();
  // Only scheduled exams have a real start window; `subject` exams are always
  // available elsewhere, so the "not started yet" gate must not apply to them.
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

// In-progress attempt with its saved answers; data is null when none.
export const getActiveAttempt = async (customerId: number, examId: number) => {
  const exam = await repo.findExam(examId);
  if (!exam) return { ok: false as const, status: 404, message: "Exam not found." };
  const attempt = await repo.findInProgressAttempt(customerId, examId);
  if (!attempt) return { ok: true as const, data: null };
  const details = await repo.detailsForResult(attempt.id);
  // A pre-cutover attempt may hold a legacy "Skip" option id; return it as
  // `answerId: null` so the app shows the question as unanswered.
  const savedIds = [...new Set(details.map((d) => d.answerId).filter((x): x is number => x != null))];
  const skipOptionIds = new Set(
    (await repo.optionsByIds(savedIds)).filter((o) => isLegacySkipOptionName(o.name)).map((o) => o.id)
  );
  return {
    ok: true as const,
    data: {
      attemptId: String(attempt.id),
      attemptNumber: attempt.attemptNumber ?? null,
      startedAt: attempt.startedAt ?? null,
      serverNow: new Date(),
      durationMinutes: exam.time,
      expired: attemptExpired(attempt.startedAt, exam.time),
      savedAnswers: details.map((d) => {
        const selected = selectedOptionId(d.answerId, skipOptionIds);
        return {
          questionId: d.questionId != null ? String(d.questionId) : null,
          answerId: selected != null ? String(selected) : null,
        };
      }),
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
    // Older builds may still select the legacy "Skip" option; it is stored as a
    // new-style skip (answer_id NULL).
    if (isLegacySkipOptionName(option.name)) { result = "skip"; answerId = null; }
    else if (norm(option.name) === norm(question.answer)) { result = "true"; point = num(exam.positiveMarks); }
    else { result = "false"; point = -Math.abs(num(exam.negativeMarks)); }
  }

  await repo.upsertAttemptDetail({ examResultId: attempt.id, customerId, examId, questionId: input.questionId, answerId, result, point });
  return { ok: true as const, data: { saved: true } };
};

// Scores saved answers (unanswered = skip), finalizes the attempt and returns the rank.
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

// Totals across all of the customer's attempts, plus rank by best score.
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
