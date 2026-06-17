import { isMysqlModule } from "../../config/migration";
import { adminExamRepository as repo } from "./admin-exam.repository";

export const ADMIN_EXAM_MODULE = "admin-exam";
export const isAdminExamMysql = (): boolean => isMysqlModule(ADMIN_EXAM_MODULE);

export const parseExamId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const splitName = (full: string | null | undefined) => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.length > 1 ? parts[parts.length - 1] : "" };
};

const toExamDto = (e: any) => ({
  _id: String(e.id),
  title: e.name,
  description: e.description ?? null,
  type: e.type,
  isPaid: e.isPaid,
  categoryId: e.ExamCategory ? { _id: String(e.ExamCategory.id), name: e.ExamCategory.name ?? null } : (e.examCategoryId != null ? String(e.examCategoryId) : null),
  durationMinutes: e.time,
  questionCount: e.numberOfQuestions,
  positiveMarks: num(e.positiveMarks),
  negativeMarks: num(e.negativeMarks),
  startAt: e.startAt ?? null,
  endAt: e.endAt ?? null,
  status: e.status,
  orderBy: e.order_by,
  createdAt: e.createAt ?? null,
  updatedAt: e.updatedAt ?? null,
});

const toQuestionDto = (q: any, options: any[] = []) => ({
  _id: String(q.id),
  title: q.name,
  answer: q.answer, // admin SEES the correct answer (unlike the client attempt view)
  examId: q.exam != null ? String(q.exam) : null,
  image: q.image ?? null,
  solutionText: q.solutionDescription ?? null,
  solutionImage: q.solutionFile ?? null,
  status: q.status,
  orderBy: q.order_by,
  options: options.map((o) => ({ _id: String(o.id), title: o.name, questionId: String(o.question) })),
});

const toCustomerRef = (c: any) =>
  c ? { _id: String(c.id), ...splitName(c.fullName), phoneNumber: c.phoneNumber, emailAddress: c.emailAddress ?? null } : null;

const toResultDto = (r: any) => ({
  _id: String(r.id),
  customerId: toCustomerRef(r.Customer),
  examId: r.Exam ? { _id: String(r.Exam.id), title: r.Exam.name, type: r.Exam.type, durationMinutes: r.Exam.time } : (r.examId != null ? String(r.examId) : null),
  total: r.total, attempt: r.attempt, skip: r.skip, success: r.success, failed: r.failed,
  score: num(r.score), timing: r.timing, ratting: r.ratting ?? null, status: r.status ?? true,
  createdAt: r.created_at ?? null,
});

// ── exams ──────────────────────────────────────────────────────────────────
export const listExams = async (opts: { search?: string; categoryId?: string; type?: string; status?: string; isPaid?: string; page: number; limit: number }) => {
  const where = {
    search: opts.search,
    categoryId: opts.categoryId ? parseExamId(opts.categoryId) ?? undefined : undefined,
    type: (opts.type === "subject" || opts.type === "daily" ? opts.type : undefined) as "subject" | "daily" | undefined,
    status: opts.status === "true" || opts.status === "published" ? true : opts.status === "false" || opts.status === "draft" ? false : undefined,
    isPaid: opts.isPaid === "true" ? true : opts.isPaid === "false" ? false : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listExams({ ...where, skip: (opts.page - 1) * opts.limit, take: opts.limit }),
    repo.countExams(where),
  ]);
  return { items: rows.map(toExamDto), total };
};

export const getExamById = async (id: number) => {
  const exam = await repo.findExam(id);
  if (!exam) return null;
  const qCount = await repo.countQuestionsForExam(id);
  return { ...toExamDto(exam), actualQuestionCount: qCount };
};

// ── questions ────────────────────────────────────────────────────────────────
export const listQuestions = async (opts: { examId?: string; search?: string; status?: string; page: number; limit: number }) => {
  const where = {
    examId: opts.examId ? parseExamId(opts.examId) ?? undefined : undefined,
    search: opts.search,
    status: opts.status === "true" ? true : opts.status === "false" ? false : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listQuestions({ ...where, skip: (opts.page - 1) * opts.limit, take: opts.limit }),
    repo.countQuestions(where),
  ]);
  const opts2 = rows.length ? await repo.optionsForQuestions(rows.map((q) => q.id)) : [];
  const byQ: Record<string, any[]> = {};
  for (const o of opts2) (byQ[String(o.question)] ||= []).push(o);
  return { items: rows.map((q) => toQuestionDto(q, byQ[String(q.id)] || [])), total };
};

export const getQuestionById = async (id: number) => {
  const q = await repo.findQuestion(id);
  if (!q) return null;
  const options = await repo.optionsForQuestions([id]);
  return toQuestionDto(q, options);
};

// ── submissions / results / analytics ────────────────────────────────────────
export const getExamSubmissions = async (examId: number, page: number, limit: number) => {
  const [rows, total] = await Promise.all([
    repo.listSubmissions(examId, (page - 1) * limit, limit),
    repo.countSubmissions(examId),
  ]);
  return { items: rows.map(toResultDto), total };
};

export const getResultById = async (id: number) => {
  const r = await repo.findResult(id);
  if (!r) return null;
  const details = await repo.detailsForResult(id);
  return {
    result: toResultDto(r),
    details: details.map((d) => ({ _id: String(d.id), questionId: d.questionId != null ? String(d.questionId) : null, answerId: d.answerId != null ? String(d.answerId) : null, result: d.result, point: num(d.point) })),
  };
};

export const invalidateResult = async (id: number) => {
  const r = await repo.findResult(id);
  if (!r) return null;
  const updated = await repo.invalidateResult(id);
  return toResultDto({ ...updated, Customer: r.Customer, Exam: r.Exam });
};

export const getCustomerAnalytics = async (customerId: number) => {
  const a = await repo.customerAnalytics(customerId);
  if (!a) return null;
  return { _id: String(a.id), customerId: String(a.customerId), exams: a.exams, questions: a.questions, attempt: a.attempt, skip: a.skip, success: a.success, failed: a.failed, score: num(a.score) };
};

export const getExamAnalytics = async (examId: number) => {
  const [overallRows, perQ] = await Promise.all([repo.examOverall(examId), repo.examPerQuestion(examId)]);
  const o = overallRows[0];
  const overall = o && num(o.totalCandidates) > 0
    ? { totalCandidates: num(o.totalCandidates), avgScore: num(o.avgScore), maxScore: num(o.maxScore), minScore: num(o.minScore), avgAccuracy: num(o.avgAccuracy) }
    : null;
  const perQuestion = perQ.map((r) => ({
    _id: r.questionId != null ? String(r.questionId) : null,
    questionTitle: r.questionTitle ?? null,
    total: num(r.total), correct: num(r.correct), wrong: num(r.wrong), skipped: num(r.skipped), accuracy: num(r.accuracy),
  }));
  return { overall, perQuestion };
};
