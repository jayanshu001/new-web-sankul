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
  solutionPdfUrl: e.solution ?? null,
  solutionPdfName: e.solutionName ?? null,
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

// ── exam writes ──────────────────────────────────────────────────────────────
// ws_exam.type is ENUM('daily','subject'); the Mongo enum also has mock/weekly
// which the SQL column can't hold, so they collapse to 'subject' (only 'daily'
// participates in the availability-window rule anyway).
const mapType = (t?: string): "daily" | "subject" => (t === "daily" ? "daily" : "subject");

export interface ExamWriteInput {
  title?: string;
  description?: string | null;
  type?: string;
  categoryId?: string | null;
  isPaid?: boolean;
  durationMinutes?: number;
  questionCount?: number;
  positiveMarks?: number;
  negativeMarks?: number;
  startAt?: Date | null;
  endAt?: Date | null;
  solutionPdfUrl?: string | null;
  solutionPdfName?: string | null;
  sendPush?: boolean;
  status?: boolean;
}

/** Current state needed by the controller to merge an update + run the overlap rule. */
export const getExamMeta = (id: number) => repo.findExamMeta(id);

/**
 * Returns the conflicting daily test as a Mongo-shaped clash ({_id,title,startAt,
 * endAt}) for the controller's 409, or null when no clash. Only PUBLISHED daily
 * tests with a complete window can clash — mirrors the Mongo `findDailyOverlap`.
 */
export const examDailyOverlap = async (c: {
  type?: string; published: boolean; startAt?: Date | null; endAt?: Date | null; excludeId?: number;
}) => {
  if (mapType(c.type) !== "daily" || !c.published || !c.startAt || !c.endAt) return null;
  const clash = await repo.findDailyOverlap({ startAt: c.startAt, endAt: c.endAt, excludeId: c.excludeId });
  return clash ? { _id: String(clash.id), title: clash.name, startAt: clash.startAt, endAt: clash.endAt } : null;
};

export const createExam = async (input: ExamWriteInput): Promise<"category_required" | ReturnType<typeof toExamDto>> => {
  // ws_exam.exam_category_id is NOT NULL in the DB (no FK, no sentinel) — an
  // exam must belong to a category, so a valid categoryId is mandatory.
  const catId = input.categoryId ? parseExamId(input.categoryId) : null;
  if (!catId) return "category_required";
  const now = new Date();
  // ws_exam.start_date / end_date are NOT NULL in the DB (even subject exams,
  // which ignore the window, carry dates). Default both to now when absent so
  // the insert satisfies the constraint; only 'daily' tests use the window.
  const row = await repo.createExam({
    name: input.title ?? "",
    type: mapType(input.type),
    examCategoryId: catId,
    isPaid: input.isPaid ?? false,
    time: input.durationMinutes ?? 0,
    numberOfQuestions: input.questionCount ?? 0,
    positiveMarks: input.positiveMarks ?? 0,
    negativeMarks: input.negativeMarks ?? 0,
    solution: input.solutionPdfUrl ?? null,
    solutionName: input.solutionPdfName ?? null,
    startAt: input.startAt ?? now,
    endAt: input.endAt ?? now,
    status: input.status ?? false,
    order_by: 0,
    send_push: input.sendPush ?? false,
    createAt: now,
    updatedAt: now,
  });
  // Unpopulated categoryId (string id) — matches the Mongo create response.
  return toExamDto(row);
};

/**
 * Returns "not_found" or { data, orphanPdfUrl }. orphanPdfUrl is the previous
 * solution PDF when the caller cleared it (solutionPdfUrl === null), so the
 * controller can best-effort delete it from S3 after the write.
 */
export const updateExam = async (id: number, input: ExamWriteInput): Promise<"not_found" | "category_required" | { data: ReturnType<typeof toExamDto>; orphanPdfUrl: string | null }> => {
  const meta = await repo.findExamMeta(id);
  if (!meta) return "not_found";

  const data: any = { updatedAt: new Date() };
  if (input.title !== undefined) data.name = input.title;
  if (input.type !== undefined) data.type = mapType(input.type);
  // exam_category_id is NOT NULL — only update it to a valid id; reject an
  // explicit null/invalid value (omitting categoryId leaves it unchanged).
  if (input.categoryId !== undefined) {
    const catId = input.categoryId ? parseExamId(input.categoryId) : null;
    if (!catId) return "category_required";
    data.examCategoryId = catId;
  }
  if (input.isPaid !== undefined) data.isPaid = input.isPaid;
  if (input.durationMinutes !== undefined) data.time = input.durationMinutes;
  if (input.questionCount !== undefined) data.numberOfQuestions = input.questionCount;
  if (input.positiveMarks !== undefined) data.positiveMarks = input.positiveMarks;
  if (input.negativeMarks !== undefined) data.negativeMarks = input.negativeMarks;
  if (input.startAt !== undefined) data.startAt = input.startAt;
  if (input.endAt !== undefined) data.endAt = input.endAt;
  if (input.status !== undefined) data.status = input.status;
  if (input.sendPush !== undefined) data.send_push = input.sendPush;

  let orphanPdfUrl: string | null = null;
  if (input.solutionPdfUrl === null) {
    orphanPdfUrl = meta.solution ?? null; // clearing → schedule old file for cleanup
    data.solution = null;
    data.solutionName = null; // clearing the file clears its original name too
  } else if (input.solutionPdfUrl !== undefined) {
    data.solution = input.solutionPdfUrl;
    if (input.solutionPdfName !== undefined) data.solutionName = input.solutionPdfName ?? null;
  } else if (input.solutionPdfName !== undefined) {
    // Renaming without changing the file (uncommon, but supported).
    data.solutionName = input.solutionPdfName ?? null;
  }

  const row = await repo.updateExam(id, data);
  return { data: toExamDto(row), orphanPdfUrl };
};

export const updateExamStatus = async (id: number, status: boolean): Promise<"not_found" | ReturnType<typeof toExamDto>> => {
  if (!(await repo.findExamMeta(id))) return "not_found";
  return toExamDto(await repo.setExamStatus(id, status));
};

export const deleteExam = async (id: number): Promise<"not_found" | true> => {
  if (!(await repo.findExamMeta(id))) return "not_found";
  await repo.deleteExamCascade(id);
  return true;
};

export const reorderExams = async (orders: Array<{ id: string; orderBy: number }>): Promise<"no_valid" | true> => {
  const valid = orders.map((o) => ({ id: parseExamId(o.id), orderBy: o.orderBy })).filter((o) => o.id != null);
  if (!valid.length) return "no_valid";
  await Promise.all(valid.map((o) => repo.setExamOrder(o.id!, o.orderBy)));
  return true;
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

// ── question writes ────────────────────────────────────────────────────────────
const normAns = (s: string) => (s ?? "").trim().toLowerCase();
const answerMatches = (answer: string, options: { name: string }[]) =>
  options.some((o) => normAns(o.name) === normAns(answer));

export interface QuestionInput {
  examId?: string;
  title?: string;
  answer?: string;
  image?: string;
  solutionText?: string;
  solutionImage?: string;
  options?: { name: string }[];
  orderBy?: number;
  status?: boolean;
}

export const createQuestion = async (input: QuestionInput): Promise<"exam_not_found" | { error: string } | ReturnType<typeof toQuestionDto>> => {
  const examId = input.examId ? parseExamId(input.examId) : null;
  if (!examId || !(await repo.examExists(examId))) return "exam_not_found";
  const options = (input.options ?? []).map((o) => ({ name: o.name }));
  if (!answerMatches(input.answer ?? "", options)) return { error: "The `answer` value must match one of the option `name`s." };
  const orderBy = input.orderBy ?? (await repo.maxQuestionOrder(examId)) + 1;
  const { q, options: saved } = await repo.createQuestion({
    examId,
    name: input.title ?? "",
    answer: input.answer ?? "",
    image: input.image ?? null,
    solutionText: input.solutionText ?? "", // NOT NULL
    solutionImage: input.solutionImage ?? null,
    orderBy,
    status: input.status ?? true,
    options,
  });
  return toQuestionDto(q, saved);
};

export const bulkCreateQuestions = async (examIdRaw: string, questions: QuestionInput[]): Promise<"exam_not_found" | { error: string } | ReturnType<typeof toQuestionDto>[]> => {
  const examId = parseExamId(examIdRaw);
  if (!examId || !(await repo.examExists(examId))) return "exam_not_found";
  for (const q of questions) {
    const opts = (q.options ?? []).map((o) => ({ name: o.name }));
    if (!answerMatches(q.answer ?? "", opts))
      return { error: `Question "${(q.title ?? "").slice(0, 40)}": The \`answer\` value must match one of the option \`name\`s.` };
  }
  let cursor = (await repo.maxQuestionOrder(examId)) + 1;
  const items = questions.map((q) => ({
    examId,
    name: q.title ?? "",
    answer: q.answer ?? "",
    image: q.image ?? null,
    solutionText: q.solutionText ?? "",
    solutionImage: q.solutionImage ?? null,
    orderBy: q.orderBy ?? cursor++,
    status: q.status ?? true,
    options: (q.options ?? []).map((o) => ({ name: o.name })),
  }));
  const created = await repo.bulkCreateQuestions(examId, items);
  return created.map((c) => toQuestionDto(c.q, c.options));
};

export const updateQuestion = async (id: number, input: QuestionInput): Promise<"not_found" | { error: string } | { data: ReturnType<typeof toQuestionDto>; orphanUrls: string[] }> => {
  const q = await repo.findQuestion(id);
  if (!q) return "not_found";

  // Validate answer↔options when either changes (uses existing values for the unchanged side).
  if (input.options || input.answer !== undefined) {
    const options = input.options ?? (await repo.optionsForQuestions([id])).map((o) => ({ name: o.name }));
    const answer = input.answer ?? q.answer ?? "";
    if (!answerMatches(answer, options)) return { error: "The `answer` value must match one of the option `name`s." };
  }

  const data: any = { updatedAt: new Date() };
  const orphanUrls: string[] = [];
  if (input.title !== undefined) data.name = input.title;
  if (input.answer !== undefined) data.answer = input.answer;
  if (input.solutionText !== undefined) data.solutionDescription = input.solutionText;
  if (input.status !== undefined) data.status = input.status;
  // "" clears the stored image (and orphans the old S3 object); a new URL replaces it.
  if (input.image !== undefined) {
    if (input.image === "") { data.image = null; if (q.image) orphanUrls.push(q.image); }
    else { data.image = input.image; if (q.image && q.image !== input.image) orphanUrls.push(q.image); }
  }
  if (input.solutionImage !== undefined) {
    if (input.solutionImage === "") { data.solutionFile = null; if (q.solutionFile) orphanUrls.push(q.solutionFile); }
    else { data.solutionFile = input.solutionImage; if (q.solutionFile && q.solutionFile !== input.solutionImage) orphanUrls.push(q.solutionFile); }
  }

  const newOptions = input.options ? input.options.map((o) => ({ name: o.name })) : null;
  const recount = input.status !== undefined;
  const { q: updated, options } = await repo.updateQuestion(id, q.exam ?? 0, data, newOptions, recount);
  return { data: toQuestionDto(updated, options), orphanUrls };
};

export const deleteQuestion = async (id: number): Promise<"not_found" | true> => {
  const q = await repo.findQuestion(id);
  if (!q) return "not_found";
  await repo.deleteQuestion(id, q.exam ?? 0);
  return true;
};

export const reorderQuestions = async (orders: Array<{ id: string; orderBy: number }>): Promise<"no_valid" | true> => {
  const valid = orders.map((o) => ({ id: parseExamId(o.id), orderBy: o.orderBy })).filter((o) => o.id != null);
  if (!valid.length) return "no_valid";
  await Promise.all(valid.map((o) => repo.setQuestionOrder(o.id!, o.orderBy)));
  return true;
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
