// Client quizzes: HTTP handlers for exam lists, attempts, solutions and analytics.
import { Request, Response } from "express";
import { generateExamSolutionPdf } from "../../libs/core/generate";
import {
  rateResultSchema,
  submitAttemptSchema,
} from "./exam.validation";
import logger from "../../utils/logger";
import { flushUserRouteCache } from "../../middlewares/autoFlush";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { omit, omitList } from "../../utils/pick";
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
  getOverallAnalytics as svcGetOverallAnalytics,
  rateResult as svcRateResult,
  listPastDailyResults as svcListPastDailyResults,
} from "../../modules/client-exam/client-exam.service";
import * as catalogExam from "../../modules/catalog-exam/catalog-exam.service";

// Accepts legacy 24-hex ids as well as numeric ids.
const isObjectId = (v: string) => /^([a-fA-F0-9]{24}|[1-9]\d*)$/.test(v);
const norm = (s: string) => (s ?? "").trim().toLowerCase();

export const listCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCategories invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { parentId } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

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

export const listExamsByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const categoryId = req.params.categoryId as string;
  logger.info("listExamsByCategory invoked", { traceId, path: req.originalUrl, customerId, categoryId });

  try {
    const catId = parseExamId(categoryId);
    if (!catId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const cid = customerId ? parseExamId(customerId) : null;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { total, ...data } = await svcListExamsByCategory(catId, cid, { skip, take: limit, search });
    logger.info("listExamsByCategory success", { traceId, customerId, categoryId, examCount: data.exams.length });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listExamsByCategory failed", { traceId, customerId, categoryId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Drill-down filter (all params optional, applied progressively):
//   no params              -> years      [{ year, testsCount }]
//   ?year=YYYY             -> months     [{ year, month, label, testsCount }]
//   ?year&month            -> weeks      [{ week, label, startDate, endDate, testsCount }]
//   ?year&month&week       -> tests      (same shape as before, decorated per-customer)
// Bucketing lives in utils/dateBuckets (applied by the service); this handler only validates params.

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

    // Pagination + search apply only to the leaf "tests" level (a genuine exam
    // list); the years/months/weeks levels are bounded aggregate summaries.
    const cid = customerId ? parseExamId(customerId) : null;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const r = await svcGetDailyExams({ year: yearQ, month: monthQ, week: weekQ, customerId: cid, skip, take: limit, search });
    logger.info("getDailyExams success", { traceId, customerId, level: r.level });
    const body: Record<string, any> = { success: true, data: { level: r.level, items: r.data } };
    if (r.level === "tests") body.pagination = buildPagination((r as any).total ?? r.data.length, page, limit);
    return res.status(200).json(body);
  } catch (error: any) {
    logger.error("getDailyExams failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getExamQuestions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getExamQuestions invoked", { traceId, path: req.originalUrl, examId: id, userId: req.user?.id });

  try {
    const numId = parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const data = await svcGetExamQuestions(numId);
    if (!data) return res.status(404).json({ success: false, message: "Exam not found or not published." });
    logger.info("getExamQuestions success", { traceId, examId: id, questionCount: data.questions.length });
    // TestScreen renders MCQ text only: drop the exam wrapper, per-question
    // image/orderBy and answer image/isSelect (see docs/api-optimization).
    const slim = {
      questions: (data.questions ?? []).map((q: any) => ({
        ...omit(q, ["image", "orderBy"]),
        answers: (q.answers ?? []).map((a: any) => omit(a, ["image", "isSelect"])),
      })),
    };
    return res.status(200).json({ success: true, data: slim });
  } catch (error: any) {
    logger.error("getExamQuestions failed", { traceId, examId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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

    const cid = parseExamId(customerId);
    const body = req.body ?? {};
    const examId = parseExamId(String(body.examId ?? ""));
    const timing = typeof body.timing === "string" ? body.timing : "";
    const test = Array.isArray(body.test) ? body.test : null;
    if (!cid || !examId || !test || !/^\d{1,3}:\d{2}(:\d{2})?$/.test(timing)) {
      return res.status(400).json({ success: false, message: "Invalid submission payload." });
    }
    // A null/omitted answerId means skipped; an unparseable non-empty one is a bad payload.
    type ParsedAnswer = { questionId: number | null; answerId: number | null; answerAbsent: boolean };
    const parsedTest: ParsedAnswer[] = test.map((t: any) => {
      const rawAnswer = t?.answerId;
      const isAbsent = rawAnswer === null || rawAnswer === undefined || rawAnswer === "";
      return {
        questionId: parseExamId(String(t?.questionId ?? "")),
        answerId: isAbsent ? null : parseExamId(String(rawAnswer)),
        answerAbsent: isAbsent,
      };
    });
    if (parsedTest.some((t) => !t.questionId || (!t.answerAbsent && !t.answerId))) {
      return res.status(400).json({ success: false, message: "Invalid question/answer id in submission." });
    }
    const result = await svcSaveAnswers(cid, {
      examId, timing, ratting: body.ratting ?? null,
      test: parsedTest.map((t) => ({ questionId: t.questionId as number, answerId: t.answerId })),
    });
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    // Exam lists embed per-user isCompleted/lastResult under a 24h cache — drop this user's keys.
    await flushUserRouteCache(cid);
    logger.info("saveAnswers success", { traceId, customerId, examId, rank: result.rank });
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

// Per-question solution for the latest submitted attempt, or ?attemptId.
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
    // Drop unused question `image` + `answers[].image` (TestResultScreen renders
    // text-only solution). See docs/api-optimization.
    const slim = data.map((q: any) => ({
      ...omit(q, ["image"]),
      ...(Array.isArray(q.answers) ? { answers: q.answers.map((a: any) => omit(a, ["image"])) } : {}),
    }));
    logger.info("getSolutionByExam success", { traceId, customerId, examId, questionCount: data.length });
    return res.status(200).json({ success: true, data: slim });
  } catch (error: any) {
    logger.error("getSolutionByExam failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
    // TestScoreScreen reads the analytics numbers only (see docs/api-optimization).
    return res.status(200).json({
      success: true,
      data: omit(data, ["_id", "examId", "ratting", "createdAt"]),
    });
  } catch (error: any) {
    logger.error("getSolutionAnalyticsByExam failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Streams the solution PDF as a file attachment.
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

export const listMyResults = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyResults invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyResults unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { search, page, limit } = parseListQuery(req.query);

    const cid = parseExamId(customerId);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { items, total } = await svcListMyResults(cid, page, limit, search);
    logger.info("listMyResults success", { traceId, customerId, total });
    return res.status(200).json({
      success: true,
      data: omitList(items, ["ratting"]), // unused typo'd field
      pagination: buildPagination(total, page, limit),
    });
  } catch (error: any) {
    logger.error("listMyResults failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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

    const { search, page, limit } = parseListQuery(req.query);

    const cid = parseExamId(customerId);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { items: data, total } = await svcListPastDailyResults(cid, page, limit, search);
    logger.info("listMyPastDailyResults success", { traceId, customerId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: buildPagination(total, page, limit),
    });
  } catch (error: any) {
    logger.error("listMyPastDailyResults failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyOverallAnalytics = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getMyOverallAnalytics invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("getMyOverallAnalytics unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    const cid = parseExamId(customerId);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const analytics = await svcGetOverallAnalytics(cid);
    logger.info("getMyOverallAnalytics success", { traceId, customerId });
    return res.status(200).json({ success: true, data: analytics });
  } catch (error: any) {
    logger.error("getMyOverallAnalytics failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
    const cid = parseExamId(customerId);
    const eid = parseExamId(examId);
    if (!cid || !eid) {
      logger.warn("rateExamResult invalid id", { traceId, examId });
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    }

    const { ratting } = rateResultSchema.parse(req.body);
    const result = await svcRateResult(cid, eid, ratting);
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

export const getExamDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getExamDetail invoked", { traceId, path: req.originalUrl, examId: id, userId: req.user?.id });

  try {
    const numId = parseExamId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const data = await svcGetExamDetail(numId);
    if (!data) return res.status(404).json({ success: false, message: "Exam not found or not published." });
    logger.info("getExamDetail success", { traceId, examId: id });
    // Instruction DTO only — TestInstruction reads title/duration/counts/marks
    // (see docs/api-optimization/GET_client_quizzes_id_detail.md).
    return res.status(200).json({
      success: true,
      data: omit(data, ["_id", "type", "isPaid", "startAt", "endAt", "orderBy", "createdAt"]),
    });
  } catch (error: any) {
    logger.error("getExamDetail failed", { traceId, examId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

const isAttemptExpired = (r: any, durationMinutes: number) => {
  if (!r?.startedAt) return false;
  const deadline = new Date(r.startedAt).getTime() + durationMinutes * 60_000;
  return Date.now() > deadline;
};

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
    logger.info("startAttempt success", { traceId, customerId, examId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    logger.error("startAttempt failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
    logger.info("saveSingleAnswer success", { traceId, customerId, examId, attemptId, questionId: qid });
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
    // Exam lists embed per-user isCompleted/lastResult under a 24h cache — drop this user's keys.
    await flushUserRouteCache(cid);
    logger.info("submitAttempt success", { traceId, customerId, examId, attemptId });
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
    const { page, limit, skip } = parseListQuery(req.query);
    const r = await svcListAttempts(cid, eid, { skip, take: limit });
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("listAttempts success", { traceId, customerId, examId });
    // ExamAnalytics reads exam.title + attempt core scores/inProgress/dates only
    // (see docs/api-optimization/GET_client_quizzes_id_attempts.md).
    const slim = {
      exam: omit(r.data.exam, ["_id", "type", "durationMinutes"]),
      attempts: omitList(r.data.attempts, ["examId", "ratting", "status"]),
    };
    return res.status(200).json({ success: true, data: slim, pagination: buildPagination(r.total, page, limit) });
  } catch (error: any) {
    logger.error("listAttempts failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
    logger.info("getAttemptsAggregate success", { traceId, customerId, examId });
    // ExamAnalytics reads exam.title, rank and the used summary fields only
    // (see docs/api-optimization/GET_client_quizzes_id_attempts_aggregate.md).
    const slim = {
      exam: omit(r.data.exam, ["_id", "questionCount"]),
      summary: omit(r.data.summary, ["attemptsCount", "scoreSum", "avgScore", "accuracy", "lastSubmittedAt"]),
      rank: r.data.rank,
    };
    return res.status(200).json({ success: true, data: slim });
  } catch (error: any) {
    logger.error("getAttemptsAggregate failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
    logger.info("getActiveAttempt success", { traceId, customerId, examId });
    return res.status(200).json({ success: true, data: r.data });
  } catch (error: any) {
    logger.error("getActiveAttempt failed", { traceId, customerId, examId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
