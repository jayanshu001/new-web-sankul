import { Request, Response } from "express";
import mongoose from "mongoose";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamResultDetailAnalytics } from "../../models/exam/ExamResultDetailAnalytics.model";
import { ExamType } from "../../models/enums";
import { generateExamSolutionPdf } from "../../libs/core/generate";
import {
  rateResultSchema,
  submitAttemptSchema,
} from "./exam.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  parseExamId,
  listExamsByCategory as svcListExamsByCategory,
  getExamQuestions as svcGetExamQuestions,
  getExamDetail as svcGetExamDetail,
  listMyResults as svcListMyResults,
  saveAnswers as svcSaveAnswers,
  getSolution as svcGetSolution,
  getSolutionAnalytics as svcGetSolutionAnalytics,
  getDailyExams as svcGetDailyExams,
  startAttempt as svcStartAttempt,
  getActiveAttempt as svcGetActiveAttempt,
  saveSingleAnswer as svcSaveSingleAnswer,
  submitAttempt as svcSubmitAttempt,
  listAttempts as svcListAttempts,
  getAttemptsAggregate as svcGetAttemptsAggregate,
} from "../../modules/client-exam/client-exam.service";
import * as catalogExam from "../../modules/catalog-exam/catalog-exam.service";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);
const norm = (s: string) => (s ?? "").trim().toLowerCase();

// ─── Discovery ────────────────────────────────────────────────────────────────

// GET /api/v1/client/exams/categories
export const listCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCategories invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { parentId } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

    // ─── ws_exam_category ──────────────────────────────────
    const [categories, total] = await Promise.all([
      catalogExam.listClientCategories({ parentId, search, skip, take: limit }),
      catalogExam.countClientCategories({ parentId, search }),
    ]);
    logger.info("listCategories success", { traceId, count: categories.length });
    return res.status(200).json({ success: true, data: categories, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listCategories failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/categories/:categoryId/exams
export const listExamsByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const categoryId = req.params.categoryId as string;
  logger.info("listExamsByCategory invoked", { traceId, path: req.originalUrl, customerId, categoryId });

  try {
    // ─── ws_exam + ws_exam_category ────────────────────────
    const catId = parseExamId(categoryId);
    if (!catId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const cid = customerId ? parseExamId(customerId) : null;
    const data = await svcListExamsByCategory(catId, cid);
    logger.info("listExamsByCategory success (sql)", { traceId, customerId, categoryId, examCount: data.exams.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("listExamsByCategory failed", { traceId, customerId, categoryId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/daily
// Drill-down filter (all params optional, applied progressively):
//   no params              -> years      [{ year, testsCount }]
//   ?year=YYYY             -> months     [{ year, month, label, testsCount }]
//   ?year&month            -> weeks      [{ week, label, startDate, endDate, testsCount }]
//   ?year&month&week       -> tests      (same shape as before, decorated per-customer)
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Week 1 = days 1–7, Week 2 = 8–14, Week 3 = 15–21, Week 4 = 22–28, Week 5 = 29–end.
const weekOfMonth = (day: number) => (day <= 28 ? Math.ceil(day / 7) : 5);
const weekRange = (year: number, month: number, week: number) => {
  const startDay = (week - 1) * 7 + 1;
  const start = new Date(year, month - 1, startDay, 0, 0, 0, 0);
  const end =
    week === 5
      ? new Date(year, month, 0, 23, 59, 59, 999) // last day of month
      : new Date(year, month - 1, startDay + 6, 23, 59, 59, 999);
  return { start, end };
};

export const getDailyExams = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getDailyExams invoked", { traceId, path: req.originalUrl, customerId, query: req.query });

  try {
    const now = new Date();
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

    const yearQ = req.query.year ? Number(req.query.year) : undefined;
    const monthQ = req.query.month ? Number(req.query.month) : undefined;
    const weekQ = req.query.week ? Number(req.query.week) : undefined;

    if (yearQ !== undefined && (!Number.isInteger(yearQ) || yearQ < 1970 || yearQ > 9999)) {
      return res.status(400).json({ success: false, message: "Invalid year." });
    }
    if (monthQ !== undefined && (!Number.isInteger(monthQ) || monthQ < 1 || monthQ > 12)) {
      return res.status(400).json({ success: false, message: "Invalid month (1-12)." });
    }
    if (weekQ !== undefined && (!Number.isInteger(weekQ) || weekQ < 1 || weekQ > 5)) {
      return res.status(400).json({ success: false, message: "Invalid week (1-5)." });
    }
    if (monthQ !== undefined && yearQ === undefined) {
      return res.status(400).json({ success: false, message: "`month` requires `year`." });
    }
    if (weekQ !== undefined && (yearQ === undefined || monthQ === undefined)) {
      return res.status(400).json({ success: false, message: "`week` requires `year` and `month`." });
    }

    // ─── daily-exam drill-down ─────────────────────────────
    const cid = customerId ? parseExamId(customerId) : null;
    const r = await svcGetDailyExams({ year: yearQ, month: monthQ, week: weekQ, customerId: cid });
    logger.info("getDailyExams success (sql)", { traceId, customerId, level: r.level });
    return res.status(200).json({ success: true, data: { level: r.level, items: r.data } });
  } catch (error: any) {
    logger.error("getDailyExams failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Taking the exam ──────────────────────────────────────────────────────────

// GET /api/v1/client/exams/:id — questions with options (old API shape). `answer` is not exposed.
export const getExamQuestions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getExamQuestions invoked", { traceId, path: req.originalUrl, examId: id, userId: req.user?.id });

  try {
    const numId = parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const data = await svcGetExamQuestions(numId);
    if (!data) return res.status(404).json({ success: false, message: "Exam not found or not published." });
    logger.info("getExamQuestions success (sql)", { traceId, examId: id, questionCount: data.questions.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getExamQuestions failed", { traceId, examId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Submission ───────────────────────────────────────────────────────────────

async function recomputeAnalytics(customerId: string) {
  const oid = new mongoose.Types.ObjectId(customerId);
  const [agg] = await ExamResult.aggregate([
    { $match: { customerId: oid, status: true } },
    {
      $group: {
        _id: null,
        exams: { $addToSet: "$examId" },
        questions: { $sum: "$total" },
        attempt: { $sum: "$attempt" },
        skip: { $sum: "$skip" },
        success: { $sum: "$success" },
        failed: { $sum: "$failed" },
        score: { $sum: "$score" },
      },
    },
    {
      $project: {
        _id: 0,
        exams: { $size: "$exams" },
        questions: 1,
        attempt: 1,
        skip: 1,
        success: 1,
        failed: 1,
        score: { $round: ["$score", 2] },
      },
    },
  ]);

  const payload = agg ?? { exams: 0, questions: 0, attempt: 0, skip: 0, success: 0, failed: 0, score: 0 };
  await ExamResultDetailAnalytics.updateOne(
    { customerId: oid },
    { $set: { customerId: oid, ...payload } },
    { upsert: true }
  );
}

// POST /api/v1/client/save/answers  (also mounted at /exams/:id/submit)
// Body: { examId, timing, test: [{questionId, answerId}, ...], ratting? }
export const saveAnswers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("saveAnswers invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("saveAnswers unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ─── ws_exam_result + _detail; scoring write ───────────
    const cid = parseExamId(customerId);
    const body = req.body ?? {};
    const examId = parseExamId(String(body.examId ?? ""));
    const timing = typeof body.timing === "string" ? body.timing : "";
    const test = Array.isArray(body.test) ? body.test : null;
    if (!cid || !examId || !test || !/^\d{1,3}:\d{2}(:\d{2})?$/.test(timing)) {
      return res.status(400).json({ success: false, message: "Invalid submission payload." });
    }
    const parsedTest = test.map((t: any) => ({ questionId: parseExamId(String(t?.questionId ?? "")), answerId: parseExamId(String(t?.answerId ?? "")) }));
    if (parsedTest.some((t: { questionId: number | null; answerId: number | null }) => !t.questionId || !t.answerId)) {
      return res.status(400).json({ success: false, message: "Invalid question/answer id in submission." });
    }
    const result = await svcSaveAnswers(cid, {
      examId, timing, ratting: body.ratting ?? null,
      test: parsedTest as Array<{ questionId: number; answerId: number }>,
    });
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    logger.info("saveAnswers success (sql)", { traceId, customerId, examId, rank: result.rank });
    return res.status(200).json({ success: true, data: { examResult: result.examResult, rank: result.rank } });
  } catch (error: any) {
    if (error.issues) {
      logger.warn("saveAnswers validation failed", { traceId, customerId, issues: error.issues });
      return res.status(400).json({ success: false, errors: error.issues });
    }
    logger.error("saveAnswers failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Post-submit views ────────────────────────────────────────────────────────

// GET /api/v1/client/exams/:id/solution
export const getSolutionByExam = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("getSolutionByExam invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("getSolutionByExam unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const attemptId = req.query.attemptId ? parseExamId(String(req.query.attemptId)) ?? undefined : undefined;
    const data = await svcGetSolution(cid, eid, attemptId);
    if (!data) return res.status(404).json({ success: false, message: "No submitted attempt found." });
    logger.info("getSolutionByExam success (sql)", { traceId, customerId, examId, questionCount: data.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getSolutionByExam failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/:id/solution/analytics
export const getSolutionAnalyticsByExam = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("getSolutionAnalyticsByExam invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("getSolutionAnalyticsByExam unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const attemptId = req.query.attemptId ? parseExamId(String(req.query.attemptId)) ?? undefined : undefined;
    const data = await svcGetSolutionAnalytics(cid, eid, attemptId);
    if (!data) return res.status(404).json({ success: false, message: "No submitted attempt found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getSolutionAnalyticsByExam failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/:id/solution/download
export const getSolutionDownloadByExam = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("getSolutionDownloadByExam invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("getSolutionDownloadByExam unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (!isObjectId(examId)) {
      logger.warn("getSolutionDownloadByExam invalid id", { traceId, examId });
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    }

    const attemptId = (req.query.attemptId as string | undefined) ?? undefined;
    const { pdf, fileName } = await generateExamSolutionPdf(examId, customerId, attemptId);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
    logger.info("getSolutionDownloadByExam success", { traceId, customerId, examId, bytes: pdf.length });
    return res.send(pdf);
  } catch (error: any) {
    const msg = error?.message || "Failed to generate PDF.";
    const code = /not found|Invalid/i.test(msg) ? 404 : 500;
    if (code === 500) {
      logger.error("getSolutionDownloadByExam failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    } else {
      logger.warn("getSolutionDownloadByExam client error", { traceId, customerId, examId, msg });
    }
    return res.status(code).json({ success: false, message: msg });
  }
};

// ─── My history / analytics ──────────────────────────────────────────────────

// GET /api/v1/client/exams/my/attempts
export const listMyResults = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyResults invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyResults unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { page = "1", limit = "20", examId } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    // ─── ws_exam_result ────────────────────────────────────
    const cid = parseExamId(customerId);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { items, total } = await svcListMyResults(cid, pageNum, limitNum);
    logger.info("listMyResults success (sql)", { traceId, customerId, total });
    return res.status(200).json({
      success: true,
      data: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMyResults failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/my/past-daily
// Past (finished) attempts of DAILY-type exams, for the "Exam Analytics" screen.
// Predicate matches the `pastExams` count on /profile/dashboard exactly so badge ⇄ list agree.
export const listMyPastDailyResults = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyPastDailyResults invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyPastDailyResults unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const cid = new mongoose.Types.ObjectId(customerId);
    const matchResult = {
      customerId: cid,
      status: true,
      inProgress: false,
      submittedAt: { $ne: null },
    };

    const pipeline: any[] = [
      { $match: matchResult },
      {
        $lookup: {
          from: "ws_exam",
          localField: "examId",
          foreignField: "_id",
          as: "exam",
        },
      },
      { $unwind: "$exam" },
      { $match: { "exam.type": ExamType.DAILY } },
      { $sort: { submittedAt: -1, attemptNumber: -1 } },
    ];

    const [data, totalRows] = await Promise.all([
      ExamResult.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limitNum },
        {
          $project: {
            _id: 1,
            attemptNumber: 1,
            total: 1,
            attempt: 1,
            skip: 1,
            success: 1,
            failed: 1,
            score: 1,
            timing: 1,
            submittedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            exam: {
              _id: "$exam._id",
              title: "$exam.title",
              type: "$exam.type",
              durationMinutes: "$exam.durationMinutes",
              positiveMarks: "$exam.positiveMarks",
              negativeMarks: "$exam.negativeMarks",
              startAt: "$exam.startAt",
            },
          },
        },
      ]),
      ExamResult.aggregate([...pipeline, { $count: "n" }]),
    ]);

    const total = totalRows[0]?.n ?? 0;
    logger.info("listMyPastDailyResults success", { traceId, customerId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMyPastDailyResults failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/my/analytics
export const getMyOverallAnalytics = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getMyOverallAnalytics invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("getMyOverallAnalytics unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    const analytics = await ExamResultDetailAnalytics.findOne({ customerId }).lean();
    logger.info("getMyOverallAnalytics success", { traceId, customerId });
    return res.status(200).json({ success: true, data: analytics });
  } catch (error: any) {
    logger.error("getMyOverallAnalytics failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/exams/:id/rate
export const rateExamResult = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("rateExamResult invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("rateExamResult unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (!isObjectId(examId)) {
      logger.warn("rateExamResult invalid id", { traceId, examId });
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    }

    const { ratting } = rateResultSchema.parse(req.body);
    const result = await ExamResult.findOneAndUpdate(
      { customerId, examId },
      { $set: { ratting } },
      { new: true }
    );
    if (!result) {
      logger.warn("rateExamResult result not found", { traceId, customerId, examId });
      return res.status(404).json({ success: false, message: "No result found to rate." });
    }
    logger.info("rateExamResult success", { traceId, customerId, examId, ratting });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) {
      logger.warn("rateExamResult validation failed", { traceId, customerId, issues: error.issues });
      return res.status(400).json({ success: false, errors: error.issues });
    }
    logger.error("rateExamResult failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/:id/detail
export const getExamDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getExamDetail invoked", { traceId, path: req.originalUrl, examId: id, userId: req.user?.id });

  try {
    const numId = parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const data = await svcGetExamDetail(numId);
    if (!data) return res.status(404).json({ success: false, message: "Exam not found or not published." });
    logger.info("getExamDetail success (sql)", { traceId, examId: id });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getExamDetail failed", { traceId, examId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Attempt lifecycle (Start / SaveAnswer / Submit / Resume) ─────────────────

const isAttemptExpired = (r: any, durationMinutes: number) => {
  if (!r?.startedAt) return false;
  const deadline = new Date(r.startedAt).getTime() + durationMinutes * 60_000;
  return Date.now() > deadline;
};

// POST /api/v1/client/quizzes/:id/attempts/start
export const startAttempt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("startAttempt invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("startAttempt unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const r = await svcStartAttempt(cid, eid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("startAttempt success (sql)", { traceId, customerId, examId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    logger.error("startAttempt failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/quizzes/:id/attempts/:attemptId/answer
// Body: { questionId, answerId? }   (answerId omitted/null => skip)
export const saveSingleAnswer = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const { id: examId, attemptId } = req.params as { id: string; attemptId: string };
  logger.info("saveSingleAnswer invoked", { traceId, path: req.originalUrl, customerId, examId, attemptId });

  try {
    if (!customerId) {
      logger.warn("saveSingleAnswer unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    const aid = parseExamId(attemptId);
    if (!cid || !eid || !aid) return res.status(400).json({ success: false, message: "Invalid exam or attempt id." });
    const qid = parseExamId(String(req.body?.questionId ?? ""));
    if (!qid) return res.status(400).json({ success: false, message: "Invalid question id." });
    const rawAns = req.body?.answerId;
    const ansId = rawAns == null || rawAns === "" ? null : parseExamId(String(rawAns));
    if (rawAns != null && rawAns !== "" && !ansId) return res.status(400).json({ success: false, message: "Invalid answer id." });
    const r = await svcSaveSingleAnswer(cid, eid, aid, { questionId: qid, answerId: ansId });
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("saveSingleAnswer success (sql)", { traceId, customerId, examId, attemptId, questionId: qid });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) {
      logger.warn("saveSingleAnswer validation failed", { traceId, customerId, issues: error.issues });
      return res.status(400).json({ success: false, errors: error.issues });
    }
    logger.error("saveSingleAnswer failed", { traceId, customerId, examId, attemptId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/quizzes/:id/attempts/:attemptId/submit
// Body: { timing?, ratting? }   Scores from saved details; unanswered => SKIP.
export const submitAttempt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const { id: examId, attemptId } = req.params as { id: string; attemptId: string };
  logger.info("submitAttempt invoked", { traceId, path: req.originalUrl, customerId, examId, attemptId });

  try {
    if (!customerId) {
      logger.warn("submitAttempt unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    const aid = parseExamId(attemptId);
    if (!cid || !eid || !aid) return res.status(400).json({ success: false, message: "Invalid exam or attempt id." });
    const data = submitAttemptSchema.parse(req.body ?? {});
    const r = await svcSubmitAttempt(cid, eid, aid, { timing: data.timing, ratting: data.ratting ?? null });
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("submitAttempt success (sql)", { traceId, customerId, examId, attemptId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    if (error.issues) {
      logger.warn("submitAttempt validation failed", { traceId, customerId, issues: error.issues });
      return res.status(400).json({ success: false, errors: error.issues });
    }
    logger.error("submitAttempt failed", { traceId, customerId, examId, attemptId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/:id/attempts
// Lists all of this user's attempts for an exam (history list).
export const listAttempts = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("listAttempts invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("listAttempts unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const r = await svcListAttempts(cid, eid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("listAttempts success (sql)", { traceId, customerId, examId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    logger.error("listAttempts failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/:id/attempts/aggregate
// Aggregate stats across ALL of this user's submitted attempts for the exam.
// Powers the donut + summary on the Exam Analytics screen.
export const getAttemptsAggregate = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("getAttemptsAggregate invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("getAttemptsAggregate unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const r = await svcGetAttemptsAggregate(cid, eid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("getAttemptsAggregate success (sql)", { traceId, customerId, examId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    logger.error("getAttemptsAggregate failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/:id/attempts/active
export const getActiveAttempt = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const examId = req.params.id as string;
  logger.info("getActiveAttempt invoked", { traceId, path: req.originalUrl, customerId, examId });

  try {
    if (!customerId) {
      logger.warn("getActiveAttempt unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const r = await svcGetActiveAttempt(cid, eid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("getActiveAttempt success (sql)", { traceId, customerId, examId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    logger.error("getActiveAttempt failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
