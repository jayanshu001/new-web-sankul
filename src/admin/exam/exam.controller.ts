import { Request, Response } from "express";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { ExamStatus } from "../../shared/enums";
import { formatScheduledAt } from "../../utils/displayTime";
import * as adminExam from "../../modules/admin-exam/admin-exam.service";
import * as catalogExam from "../../modules/catalog-exam/catalog-exam.service";
import {
  createCategorySchema,
  updateCategorySchema,
  createExamSchema,
  updateExamSchema,
  reorderExamsSchema,
  createQuestionSchema,
  updateQuestionSchema,
  reorderQuestionsSchema,
  bulkCreateQuestionsSchema,
} from "./exam.validation";

// Parse + clamp the standard list pagination params, returning the spec's
// { page, per_page } naming (vs the module's older page/limit handlers).
const parseListPaging = (q: Record<string, string>) => {
  const page = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const per_page = Math.min(Math.max(parseInt(q.per_page ?? "20", 10) || 20, 1), 200);
  return { page, per_page, skip: (page - 1) * per_page };
};

const buildMeta = (page: number, per_page: number, total: number) => ({
  page,
  per_page,
  total,
  totalPages: Math.ceil(total / per_page),
});

// ─── Exam Categories ──────────────────────────────────────────────────────────

export const getCategories = async (req: Request, res: Response) => {
  try {
    const { parentId, search, status } = req.query as Record<string, string>;
    const statusBool = status === "true" ? true : status === "false" ? false : undefined;

    // Pagination is OPTIONAL + additive: `data` stays the array (back-compat),
    // with a `pagination` sibling. Honored only when `page`/`limit` (or
    // `per_page`) is supplied; otherwise all matching rows are returned as before.
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limitRaw = (req.query.limit ?? req.query.per_page) as string | undefined;
    const limit = limitRaw !== undefined ? Math.min(Math.max(parseInt(limitRaw) || 20, 1), 500) : undefined;
    const skip = limit !== undefined ? (page - 1) * limit : undefined;
    const meta = (total: number) => ({ page, limit: limit ?? total, total, totalPages: limit ? Math.ceil(total / limit) : 1 });

    const [items, total] = await Promise.all([
      catalogExam.listCategories({ parentId, search, status: statusBool, skip, take: limit }),
      catalogExam.countCategories({ parentId, search, status: statusBool }),
    ]);
    return res.status(200).json({ success: true, data: items, pagination: meta(total) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryTree = async (_req: Request, res: Response) => {
  try {
    const roots = await catalogExam.getCategoryTree();
    return res.status(200).json({ success: true, data: roots });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = catalogExam.parseExamCategoryId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const data = await catalogExam.getCategoryByIdWithParent(numId);
    if (!data) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /categories/:id/packages — paginated, searchable packages linked to this quiz category.
export const getCategoryPackages = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = catalogExam.parseExamCategoryId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    if (!(await catalogExam.categoryExists(numId)))
      return res.status(404).json({ success: false, message: "Category not found." });
    const { search, status } = req.query as Record<string, string>;
    const { page, per_page, skip } = parseListPaging(req.query as Record<string, string>);
    const { items, total } = await catalogExam.getCategoryPackages(numId, {
      search,
      status: status === "true" ? true : status === "false" ? false : undefined,
      page,
      per_page,
      skip,
    });
    return res.status(200).json({
      success: true,
      data: { items, meta: buildMeta(page, per_page, total) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /categories/:id/courses — paginated, searchable courses linked to this quiz category.
export const getCategoryCourses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = catalogExam.parseExamCategoryId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    if (!(await catalogExam.categoryExists(numId)))
      return res.status(404).json({ success: false, message: "Category not found." });
    const { search, status } = req.query as Record<string, string>;
    const { page, per_page, skip } = parseListPaging(req.query as Record<string, string>);
    const { items, total } = await catalogExam.getCategoryCourses(numId, {
      search,
      status: status === "true" ? true : status === "false" ? false : undefined,
      page,
      per_page,
      skip,
    });
    return res.status(200).json({
      success: true,
      data: { items, meta: buildMeta(page, per_page, total) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = createCategorySchema.parse(req.body);
    const created = await catalogExam.createCategory({
      name: data.name,
      image: data.image ?? null,
      parentId: data.parentId ?? null,
      orderBy: data.orderBy,
      status: data.status,
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = catalogExam.parseExamCategoryId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = updateCategorySchema.parse(req.body);
    const r = await catalogExam.updateCategory(numId, {
      name: data.name,
      image: data.image,
      parentId: data.parentId,
      orderBy: data.orderBy,
      status: data.status,
    });
    if (r === "not_found") return res.status(404).json({ success: false, message: "Category not found." });
    if (r === "self_parent") return res.status(400).json({ success: false, message: "Category cannot be its own parent." });
    if (r === "parent_not_found") return res.status(400).json({ success: false, message: "Parent category not found." });
    if (r.orphanImageUrl) deleteFromS3FileUrl(r.orphanImageUrl).catch(() => {});
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = catalogExam.parseExamCategoryId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const r = await catalogExam.deleteCategory(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Category not found." });
    if (r === "has_children") return res.status(400).json({ success: false, message: "Category has sub-categories. Delete or reassign them first." });
    if (r === "has_exams") return res.status(400).json({ success: false, message: "Category has exams. Reassign or delete them first." });
    return res.status(200).json({ success: true, message: "Category deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Exams ────────────────────────────────────────────────────────────────────

export const getExams = async (req: Request, res: Response) => {
  try {
    const {
      search,
      categoryId,
      type,
      status,
      isPaid,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const { items, total } = await adminExam.listExams({ search, categoryId, type, status, isPaid, page: pageNum, limit: limitNum });
    return res.status(200).json({ success: true, data: items, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getExamById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminExam.parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid exam id." });
    const data = await adminExam.getExamById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

function applyExamUpload(req: Request) {
  const file = req.file as any;
  if (file?.location) {
    req.body.solutionPdfUrl = file.location;
    // Keep the user's original filename separate from the generated storage key.
    // Caller-supplied solutionPdfName wins.
    if (file.originalname && req.body.solutionPdfName == null) req.body.solutionPdfName = file.originalname;
  }
}

// IST time-only formatter for the end of a window, e.g. "11:30 pm". Start uses
// the full formatScheduledAt (date + time); end only needs the time since both
// ends share a date in the common case, keeping the range compact.
const IST_TIME_ONLY = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Builds the human-readable 409 message naming the conflicting quiz and its
// availability window, so the admin sees exactly which test blocks the slot —
// e.g. "Overlaps with 'Gujarat Police Final Practice Tests'
//       (08 Jun 2026, 6:01 pm – 11:30 pm)". Falls back gracefully if the
// conflict has no title/window.
function dailyOverlapMessage(clash: any): string {
  const title = clash?.title ? `'${clash.title}'` : "another daily test";
  const start = formatScheduledAt(clash?.startAt);
  const end =
    clash?.endAt && !Number.isNaN(new Date(clash.endAt).getTime())
      ? IST_TIME_ONLY.format(new Date(clash.endAt))
      : null;
  const window = start && end ? ` (${start} – ${end})` : start ? ` (from ${start})` : "";
  return `This daily test's time window overlaps with ${title}${window}. Pick a slot that starts after it ends.`;
}

function sendDailyOverlap(res: Response, clash: any) {
  return res
    .status(409)
    .json({ success: false, message: dailyOverlapMessage(clash), conflict: clash });
}

export const createExam = async (req: Request, res: Response) => {
  try {
    applyExamUpload(req);
    const data = createExamSchema.parse(req.body);

    const clash = await adminExam.examDailyOverlap({
      type: data.type,
      published: data.status === true,
      startAt: data.startAt,
      endAt: data.endAt,
    });
    if (clash) return sendDailyOverlap(res, clash);
    const created = await adminExam.createExam(data as any);
    if (created === "category_required") return res.status(400).json({ success: false, message: "categoryId is required." });
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateExam = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminExam.parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid exam id." });
    applyExamUpload(req);
    const data = updateExamSchema.parse(req.body);

    const current = await adminExam.getExamMeta(numId);
    if (!current) return res.status(404).json({ success: false, message: "Exam not found." });
    // Resolve effective type/window/status by merging the partial update over
    // the current row, then run the shared daily-overlap rule.
    const effectiveType = data.type ?? current.type;
    // Distinguish "cleared" (null) from "not provided" (undefined): a null must stay
    // null here so a daily test that clears its window is correctly rejected below
    // (a `?? current` would mask the clear and then persist null → invalid daily test).
    const effectiveStartAt = data.startAt !== undefined ? data.startAt : current.startAt;
    const effectiveEndAt = data.endAt !== undefined ? data.endAt : current.endAt;
    const effectivePublished = data.status !== undefined ? data.status === true : current.status;
    if (effectiveType === "daily" && (!effectiveStartAt || !effectiveEndAt))
      return res.status(400).json({ success: false, message: "startAt and endAt are required for daily tests." });
    const clash = await adminExam.examDailyOverlap({
      type: effectiveType,
      published: effectivePublished,
      startAt: effectiveStartAt,
      endAt: effectiveEndAt,
      excludeId: numId,
    });
    if (clash) return sendDailyOverlap(res, clash);

    const result = await adminExam.updateExam(numId, data as any);
    if (result === "not_found") return res.status(404).json({ success: false, message: "Exam not found." });
    if (result === "category_required") return res.status(400).json({ success: false, message: "categoryId is required." });
    if (result.orphanPdfUrl) deleteFromS3FileUrl(result.orphanPdfUrl).catch(() => {});
    return res.status(200).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteExam = async (req: Request, res: Response) => {
  try {
    const numId = adminExam.parseExamId(req.params.id as string);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid exam id." });
    const r = await adminExam.deleteExam(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, message: "Exam and related data deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateExamStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminExam.parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid exam id." });
    // ws_exam.status is boolean; accept the legacy enum string (published →
    // true, anything else → false) or a raw boolean.
    const raw = (req.body as any)?.status;
    let publish: boolean;
    if (typeof raw === "boolean") publish = raw;
    else if (Object.values(ExamStatus).includes(raw)) publish = raw === ExamStatus.PUBLISHED;
    else return res.status(400).json({ success: false, message: "Invalid status value." });

    const meta = await adminExam.getExamMeta(numId);
    if (!meta) return res.status(404).json({ success: false, message: "Exam not found." });
    // Publishing must obey the same daily-overlap rule as create/update.
    if (publish) {
      const clash = await adminExam.examDailyOverlap({
        type: meta.type,
        published: true,
        startAt: meta.startAt,
        endAt: meta.endAt,
        excludeId: numId,
      });
      if (clash) return sendDailyOverlap(res, clash);
    }
    const updated = await adminExam.updateExamStatus(numId, publish);
    if (updated === "not_found") return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderExams = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderExamsSchema.parse(req.body);
    const r = await adminExam.reorderExams(orders);
    if (r === "no_valid") return res.status(400).json({ success: false, message: "No valid ids." });
    return res.status(200).json({ success: true, message: "Exam order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Questions ────────────────────────────────────────────────────────────────
// Options live in a separate collection. Correctness uses ExamQuestion.answer text match.

export const getQuestions = async (req: Request, res: Response) => {
  try {
    const { examId, search, status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const { items, total } = await adminExam.listQuestions({ examId, search, status, page: pageNum, limit: limitNum });
    return res.status(200).json({ success: true, data: items, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminExam.parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid question id." });
    const data = await adminExam.getQuestionById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Resolves the multipart "image-or-URL-or-clear" convention for question
// endpoints. Mutates req.body to the shape the Zod schema + downstream handlers
// expect. Returns a list of validation errors (e.g. missing @file:<i>) so the
// caller can short-circuit with 400.
type QuestionImageError = { message: string };
const coerceQuestionImages = (req: Request): QuestionImageError | null => {
  const body = req.body as Record<string, any>;

  // Parse options=JSON-string (multipart) into array.
  if (typeof body.options === "string") {
    const s = body.options.trim();
    if (s.startsWith("[")) {
      try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) body.options = parsed; } catch {}
    }
  }

  // Index uploaded files by fieldname. With upload.any(), req.files is an array.
  const files = (req.files as Express.MulterS3.File[] | undefined) ?? [];
  const filesByField = new Map<string, Express.MulterS3.File>();
  for (const f of files) filesByField.set(f.fieldname, f);

  // image / solutionImage: file present -> use URL; "" -> "" (handler treats
  // as clear); URL stays.
  for (const field of ["image", "solutionImage"] as const) {
    const f = filesByField.get(field);
    if (f) body[field] = (f as any).location;
  }

  // Normalize option.image "" to undefined so create-paths default to null
  // cleanly. Real clears on update are handled in updateQuestion.
  if (Array.isArray(body.options)) {
    for (const opt of body.options) {
      if (opt && typeof opt === "object" && opt.image === "") delete opt.image;
    }
  }

  // options[i].image: "@file:<i>" -> resolve from optionImage_<i>.
  if (Array.isArray(body.options)) {
    for (let i = 0; i < body.options.length; i++) {
      const opt = body.options[i];
      if (!opt || typeof opt !== "object") continue;
      if (typeof opt.image === "string" && opt.image.startsWith("@file:")) {
        const idx = opt.image.slice("@file:".length);
        const file = filesByField.get(`optionImage_${idx}`);
        if (!file)
          return { message: `Missing uploaded file for option ${idx} (expected field optionImage_${idx}).` };
        opt.image = (file as any).location;
      }
    }
  }

  return null;
};

export const createQuestion = async (req: Request, res: Response) => {
  try {
    const coerceErr = coerceQuestionImages(req);
    if (coerceErr) return res.status(400).json({ success: false, message: coerceErr.message });
    const data = createQuestionSchema.parse(req.body);
    const r = await adminExam.createQuestion(data as any);
    if (r === "exam_not_found") return res.status(404).json({ success: false, message: "Exam not found." });
    if (typeof r === "object" && "error" in r) return res.status(400).json({ success: false, message: r.error });
    return res.status(201).json({ success: true, data: r });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkCreateQuestions = async (req: Request, res: Response) => {
  try {
    const { examId, questions } = bulkCreateQuestionsSchema.parse(req.body);
    const r = await adminExam.bulkCreateQuestions(examId, questions as any);
    if (r === "exam_not_found") return res.status(404).json({ success: false, message: "Exam not found." });
    if (!Array.isArray(r) && "error" in r) return res.status(400).json({ success: false, message: r.error });
    return res.status(201).json({ success: true, data: r, count: (r as any[]).length });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const numId = adminExam.parseExamId(req.params.id as string);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid question id." });
    const coerceErr = coerceQuestionImages(req);
    if (coerceErr) return res.status(400).json({ success: false, message: coerceErr.message });
    const data = updateQuestionSchema.parse(req.body);
    const r = await adminExam.updateQuestion(numId, data as any);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Question not found." });
    if ("error" in r) return res.status(400).json({ success: false, message: r.error });
    if (r.orphanUrls.length) Promise.all(r.orphanUrls.map((u) => deleteFromS3FileUrl(u).catch(() => {}))).catch(() => {});
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const numId = adminExam.parseExamId(req.params.id as string);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid question id." });
    const r = await adminExam.deleteQuestion(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, message: "Question deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderQuestions = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderQuestionsSchema.parse(req.body);
    const r = await adminExam.reorderQuestions(orders);
    if (r === "no_valid") return res.status(400).json({ success: false, message: "No valid ids." });
    return res.status(200).json({ success: true, message: "Question order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Submissions / Analytics ──────────────────────────────────────────────────

// GET /api/v1/admin/exams/:examId/submissions
export const getExamSubmissions = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const numId = adminExam.parseExamId(examId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid exam id." });
    const { items, total } = await adminExam.getExamSubmissions(numId, pageNum, limitNum);
    return res.status(200).json({ success: true, data: items, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exams/:examId/analytics
export const getExamAnalytics = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    const numId = adminExam.parseExamId(examId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid exam id." });
    const data = await adminExam.getExamAnalytics(numId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exams/results/:id — fetch one ExamResult with details
export const getResultById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminExam.parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid result id." });
    const data = await adminExam.getResultById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Result not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/v1/admin/exams/results/:id/invalidate — zero out a result (retains row)
export const invalidateResult = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminExam.parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid result id." });
    const data = await adminExam.invalidateResult(numId);
    if (!data) return res.status(404).json({ success: false, message: "Result not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exams/analytics/customer/:customerId — lifetime aggregates
export const getCustomerAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    const numId = adminExam.parseExamId(customerId);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid customer id." });
    const data = await adminExam.getCustomerAnalytics(numId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
