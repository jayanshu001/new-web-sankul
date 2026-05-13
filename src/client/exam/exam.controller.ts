import { Request, Response } from "express";
import mongoose from "mongoose";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { ExamQuestion } from "../../models/exam/ExamQuestion.model";
import { ExamQuestionOption } from "../../models/exam/ExamQuestionOption.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamResultDetail } from "../../models/exam/ExamResultDetail.model";
import { ExamResultDetailAnalytics } from "../../models/exam/ExamResultDetailAnalytics.model";
import { ExamStatus, ExamResultType, ExamType } from "../../models/enums";
import { generateExamSolutionPdf } from "../../libs/core/generate";
import {
  saveAnswersSchema,
  rateResultSchema,
  saveSingleAnswerSchema,
  submitAttemptSchema,
} from "./exam.validation";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);
const norm = (s: string) => (s ?? "").trim().toLowerCase();

// ─── Discovery ────────────────────────────────────────────────────────────────

// GET /api/v1/client/exams/categories
export const listCategories = async (req: Request, res: Response) => {
  try {
    const { parentId } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (!parentId || parentId === "root") filter.parentId = null;
    else if (isObjectId(parentId)) filter.parentId = parentId;

    const categories = await ExamCategory.find(filter)
      .select("_id name image parentId orderBy")
      .sort({ orderBy: 1, name: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/categories/:categoryId/exams
export const listExamsByCategory = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const categoryId = req.params.categoryId as string;
    if (!isObjectId(categoryId))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const subjects = await ExamCategory.find({ parentId: categoryId, status: true })
      .select("_id name image orderBy")
      .sort({ orderBy: 1, name: 1 });

    const exams = await Exam.find({
      categoryId,
      status: ExamStatus.PUBLISHED,
    })
      .select("_id title type isPaid durationMinutes questionCount positiveMarks negativeMarks startAt language difficulty orderBy")
      .sort({ orderBy: 1, createdAt: -1 });

    let resultByExam = new Map<string, any>();
    if (customerId && exams.length) {
      const examIds = exams.map((e) => e._id);
      const results = await ExamResult.find({
        customerId,
        examId: { $in: examIds },
        status: true,
      })
        .select("examId score total success failed skip attempt timing updatedAt")
        .sort({ updatedAt: -1, attemptNumber: -1 })
        .lean();
      for (const r of results) {
        const key = String(r.examId);
        if (!resultByExam.has(key)) resultByExam.set(key, r);
      }
    }

    const decorated = exams.map((e: any) => ({
      ...e.toObject(),
      isCompleted: resultByExam.has(String(e._id)),
      lastResult: resultByExam.get(String(e._id)) ?? null,
    }));
    const completedTests = decorated.filter(
      (exam: any) => exam.type === ExamType.SUBJECT && exam.isCompleted
    );

    return res.status(200).json({
      success: true,
      data: { subjects, exams: decorated, completedTests },
    });
  } catch (error: any) {
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
  try {
    const customerId = req.user?.id;
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

    const baseMatch: any = {
      type: ExamType.DAILY,
      status: ExamStatus.PUBLISHED,
      startAt: { $lte: endOfDay },
    };

    // Level 1: years
    if (yearQ === undefined) {
      const rows = await Exam.aggregate([
        { $match: baseMatch },
        { $group: { _id: { $year: "$startAt" }, testsCount: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $project: { _id: 0, year: "$_id", testsCount: 1 } },
      ]);
      return res.status(200).json({ success: true, data: { level: "years", items: rows } });
    }

    // Level 2: months in a year
    if (monthQ === undefined) {
      const yearStart = new Date(yearQ, 0, 1, 0, 0, 0, 0);
      const yearEnd = new Date(yearQ, 11, 31, 23, 59, 59, 999);
      const upper = yearEnd < endOfDay ? yearEnd : endOfDay;
      const rows = await Exam.aggregate([
        { $match: { ...baseMatch, startAt: { $gte: yearStart, $lte: upper } } },
        { $group: { _id: { $month: "$startAt" }, testsCount: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: "$_id", testsCount: 1 } },
      ]);
      const items = rows.map((r: any) => ({
        year: yearQ,
        month: r.month,
        label: MONTH_LABELS[r.month - 1],
        testsCount: r.testsCount,
      }));
      return res.status(200).json({ success: true, data: { level: "months", year: yearQ, items } });
    }

    // Level 3: weeks in a month
    if (weekQ === undefined) {
      const monthStart = new Date(yearQ, monthQ - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(yearQ, monthQ, 0, 23, 59, 59, 999);
      const upper = monthEnd < endOfDay ? monthEnd : endOfDay;
      const exams = await Exam.find({
        ...baseMatch,
        startAt: { $gte: monthStart, $lte: upper },
      }).select("startAt");

      const counts = new Map<number, number>();
      for (const e of exams) {
        if (!e.startAt) continue;
        const w = weekOfMonth(new Date(e.startAt as Date).getDate());
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
      const items = Array.from(counts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([week, testsCount]) => {
          const { start, end } = weekRange(yearQ, monthQ, week);
          return {
            week,
            label: `Week ${week}`,
            startDate: start,
            endDate: end,
            testsCount,
          };
        });
      return res.status(200).json({
        success: true,
        data: { level: "weeks", year: yearQ, month: monthQ, items },
      });
    }

    // Level 4: tests in a week (original shape, with per-customer stats)
    const { start: weekStart, end: weekEnd } = weekRange(yearQ, monthQ, weekQ);
    const upper = weekEnd < endOfDay ? weekEnd : endOfDay;

    const exams = await Exam.find({
      ...baseMatch,
      startAt: { $gte: weekStart, $lte: upper },
    })
      .select("_id title durationMinutes questionCount positiveMarks negativeMarks startAt orderBy language")
      .sort({ startAt: 1 });

    const statsByExam = new Map<string, { attemptsCount: number; bestScore: number; lastResult: any }>();
    if (customerId && exams.length) {
      const cid = new mongoose.Types.ObjectId(customerId);
      const examIds = exams.map((e) => e._id);
      const agg = await ExamResult.aggregate([
        { $match: { customerId: cid, examId: { $in: examIds }, status: true } },
        { $sort: { submittedAt: -1, attemptNumber: -1 } },
        {
          $group: {
            _id: "$examId",
            attemptsCount: { $sum: 1 },
            bestScore: { $max: "$score" },
            last: { $first: "$$ROOT" },
          },
        },
      ]);
      for (const row of agg) {
        statsByExam.set(String(row._id), {
          attemptsCount: row.attemptsCount,
          bestScore: row.bestScore,
          lastResult: {
            _id: row.last._id,
            attemptNumber: row.last.attemptNumber,
            score: row.last.score,
            timing: row.last.timing,
            submittedAt: row.last.submittedAt,
          },
        });
      }
    }

    const decorated = exams.map((e: any) => {
      const s = statsByExam.get(String(e._id));
      return {
        ...e.toObject(),
        attemptsCount: s?.attemptsCount ?? 0,
        bestScore: s?.bestScore ?? 0,
        isAttempted: (s?.attemptsCount ?? 0) > 0,
        lastResult: s?.lastResult ?? null,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        level: "tests",
        year: yearQ,
        month: monthQ,
        week: weekQ,
        items: decorated,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Taking the exam ──────────────────────────────────────────────────────────

// GET /api/v1/client/exams/:id — questions with options (old API shape). `answer` is not exposed.
export const getExamQuestions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const exam = await Exam.findOne({ _id: id, status: ExamStatus.PUBLISHED });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found or not published." });

    const questions = await ExamQuestion.find({ examId: id, status: true })
      .sort({ orderBy: 1, createdAt: 1 })
      .select("_id title image orderBy")
      .lean();

    const qIds = questions.map((q: any) => q._id);
    const options = await ExamQuestionOption.find({ questionId: { $in: qIds } })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();
    const optsByQ: Record<string, any[]> = {};
    options.forEach((o: any) => {
      (optsByQ[String(o.questionId)] ||= []).push({
        _id: o._id,
        name: o.name,
        image: o.image ?? null,
        isSelect: false,
      });
    });

    const decorated = questions.map((q: any) => ({
      ...q,
      answers: optsByQ[String(q._id)] || [],
    }));

    return res.status(200).json({ success: true, data: { exam, questions: decorated } });
  } catch (error: any) {
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
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = saveAnswersSchema.parse(req.body);

    const exam = await Exam.findById(data.examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam is not found." });

    if (exam.questionCount !== data.test.length) {
      return res.status(400).json({
        success: false,
        message: `Exam's total questions are not match with your total answers.`,
      });
    }

    const details: Array<{
      questionId: string;
      answerId: string;
      result: ExamResultType;
      point: number;
    }> = [];

    for (const item of data.test) {
      const question = await ExamQuestion.findOne({
        _id: item.questionId,
        examId: data.examId,
      });
      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Sorry, Question are not match with their exam.",
        });
      }
      const option = await ExamQuestionOption.findOne({
        _id: item.answerId,
        questionId: item.questionId,
      });
      if (!option) {
        return res.status(400).json({
          success: false,
          message: "Sorry, Answer is not match with their exam and question.",
        });
      }

      let result: ExamResultType;
      if (norm(option.name) === "skip") result = ExamResultType.SKIP;
      else if (norm(option.name) === norm(question.answer)) result = ExamResultType.TRUE;
      else result = ExamResultType.FALSE;

      const point =
        result === ExamResultType.SKIP
          ? 0
          : result === ExamResultType.TRUE
          ? exam.positiveMarks
          : -Math.abs(exam.negativeMarks);

      details.push({
        questionId: item.questionId,
        answerId: item.answerId,
        result,
        point,
      });
    }

    let total = details.length;
    let skip = 0, success = 0, failed = 0, score = 0;
    for (const d of details) {
      if (d.result === ExamResultType.SKIP) skip += 1;
      else if (d.result === ExamResultType.TRUE) success += 1;
      else failed += 1;
      score += d.point;
    }
    const attempt = total - skip;

    let examResult: any;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const last = await ExamResult.findOne({ customerId, examId: data.examId })
          .sort({ attemptNumber: -1 })
          .select("attemptNumber")
          .session(session);
        const nextNumber = (last?.attemptNumber ?? 0) + 1;
        const now = new Date();
        const created = await ExamResult.create(
          [
            {
              customerId,
              examId: data.examId,
              attemptNumber: nextNumber,
              total,
              attempt,
              skip,
              success,
              failed,
              score: Math.round(score * 100) / 100,
              timing: data.timing,
              ratting: data.ratting ?? null,
              status: true,
              inProgress: false,
              startedAt: now,
              submittedAt: now,
            },
          ],
          { session }
        );
        examResult = created[0];

        for (const d of details) {
          await ExamResultDetail.updateOne(
            { examResultId: examResult._id, questionId: d.questionId },
            {
              $set: {
                examResultId: examResult._id,
                customerId,
                examId: data.examId,
                questionId: d.questionId,
                answerId: d.answerId,
                result: d.result,
                point: d.point,
              },
            },
            { upsert: true, session }
          );
        }
      });
    } finally {
      session.endSession();
    }

    await recomputeAnalytics(customerId);

    const bestPerUser = await ExamResult.aggregate([
      { $match: { examId: new mongoose.Types.ObjectId(data.examId), status: true } },
      { $group: { _id: "$customerId", best: { $max: "$score" } } },
    ]);
    const myBest = bestPerUser.find((u: any) => String(u._id) === String(customerId))?.best ?? examResult.score;
    const higher = bestPerUser.filter((u: any) => u.best > myBest).length;
    const totalCandidates = bestPerUser.length;
    const rank = higher + 1;

    return res.status(200).json({
      success: true,
      data: {
        examResult,
        rank: `${rank}/${totalCandidates}`,
      },
    });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Post-submit views ────────────────────────────────────────────────────────

// GET /api/v1/client/exams/:id/solution
export const getSolutionByExam = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    // Resolve which attempt to show: ?attemptId=<id> if provided, else latest submitted.
    const reqAttemptId = (req.query.attemptId as string | undefined) ?? undefined;
    let target;
    if (reqAttemptId) {
      if (!isObjectId(reqAttemptId))
        return res.status(400).json({ success: false, message: "Invalid attemptId." });
      target = await ExamResult.findOne({ _id: reqAttemptId, customerId, examId, status: true });
    } else {
      target = await ExamResult.findOne({ customerId, examId, status: true })
        .sort({ submittedAt: -1, attemptNumber: -1 });
    }
    if (!target)
      return res.status(404).json({ success: false, message: "No submitted attempt found." });

    const details = await ExamResultDetail.find({ examResultId: target._id })
      .populate({ path: "questionId", model: ExamQuestion })
      .lean();

    const qIds = details
      .map((d: any) => d.questionId?._id)
      .filter(Boolean);
    const options = await ExamQuestionOption.find({ questionId: { $in: qIds } })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();
    const optsByQ: Record<string, any[]> = {};
    options.forEach((o: any) => {
      (optsByQ[String(o.questionId)] ||= []).push(o);
    });

    const questionList = details
      .filter((d: any) => d.questionId)
      .map((d: any) => {
        const q = d.questionId;
        const questionOptions = (optsByQ[String(q._id)] || []).map((o: any) => ({
          _id: o._id,
          name: o.name,
          image: o.image ?? null,
          isSelect: String(d.answerId) === String(o._id),
          isCorrect: norm(q.answer) === norm(o.name),
        }));
        return { ...q, answers: questionOptions, result: d.result, point: d.point };
      });

    return res.status(200).json({ success: true, data: questionList });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/:id/solution/analytics
export const getSolutionAnalyticsByExam = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const reqAttemptId = (req.query.attemptId as string | undefined) ?? undefined;
    let examResult: any;
    if (reqAttemptId) {
      if (!isObjectId(reqAttemptId))
        return res.status(400).json({ success: false, message: "Invalid attemptId." });
      examResult = await ExamResult.findOne({ _id: reqAttemptId, customerId, examId, status: true }).lean();
    } else {
      examResult = await ExamResult.findOne({ customerId, examId, status: true })
        .sort({ submittedAt: -1, attemptNumber: -1 })
        .lean();
    }
    if (!examResult)
      return res.status(404).json({ success: false, message: "No submitted attempt found." });

    const accuracy =
      examResult.total > 0 ? (examResult.success * 100) / examResult.total : 0;

    // Rank = customer's best score across attempts.
    const bestPerUser = await ExamResult.aggregate([
      { $match: { examId: new mongoose.Types.ObjectId(examId), status: true } },
      { $group: { _id: "$customerId", best: { $max: "$score" } } },
    ]);
    const myBest = bestPerUser.find((u: any) => String(u._id) === String(customerId))?.best ?? examResult.score;
    const higher = bestPerUser.filter((u: any) => u.best > myBest).length;
    const totalCandidates = bestPerUser.length;

    examResult.accuracy = Math.round(accuracy * 100) / 100;
    examResult.rank = `${higher + 1}/${totalCandidates}`;

    return res.status(200).json({ success: true, data: { examResult } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/:id/solution/download
export const getSolutionDownloadByExam = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const attemptId = (req.query.attemptId as string | undefined) ?? undefined;
    const { pdf, fileName } = await generateExamSolutionPdf(examId, customerId, attemptId);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
    return res.send(pdf);
  } catch (error: any) {
    const msg = error?.message || "Failed to generate PDF.";
    const code = /not found|Invalid/i.test(msg) ? 404 : 500;
    return res.status(code).json({ success: false, message: msg });
  }
};

// ─── My history / analytics ──────────────────────────────────────────────────

// GET /api/v1/client/exams/my/attempts
export const listMyResults = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { page = "1", limit = "20", examId } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { customerId, status: true };
    if (examId && isObjectId(examId)) filter.examId = examId;

    const [data, total] = await Promise.all([
      ExamResult.find(filter)
        .populate("examId", "_id title type durationMinutes positiveMarks negativeMarks")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      ExamResult.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/my/past-daily
// Past (finished) attempts of DAILY-type exams, for the "Exam Analytics" screen.
// Predicate matches the `pastExams` count on /profile/dashboard exactly so badge ⇄ list agree.
export const listMyPastDailyResults = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

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
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/my/analytics
export const getMyOverallAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const analytics = await ExamResultDetailAnalytics.findOne({ customerId }).lean();
    return res.status(200).json({ success: true, data: analytics });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/exams/:id/rate
export const rateExamResult = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const { ratting } = rateResultSchema.parse(req.body);
    const result = await ExamResult.findOneAndUpdate(
      { customerId, examId },
      { $set: { ratting } },
      { new: true }
    );
    if (!result)
      return res.status(404).json({ success: false, message: "No result found to rate." });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/:id/detail
export const getExamDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });
    const exam = await Exam.findOne({ _id: id, status: ExamStatus.PUBLISHED });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found or not published." });
    return res.status(200).json({ success: true, data: exam });
  } catch (error: any) {
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
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const exam = await Exam.findOne({ _id: examId, status: ExamStatus.PUBLISHED });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found or not published." });

    const now = new Date();
    if (exam.startAt && now < new Date(exam.startAt))
      return res.status(400).json({ success: false, message: "Exam has not started yet." });

    // Resume any in-progress attempt instead of creating a new row.
    const inProgress = await ExamResult.findOne({ customerId, examId, status: false });
    let attempt;
    if (inProgress) {
      attempt = inProgress;
    } else {
      const last = await ExamResult.findOne({ customerId, examId })
        .sort({ attemptNumber: -1 })
        .select("attemptNumber");
      const nextNumber = (last?.attemptNumber ?? 0) + 1;
      attempt = await ExamResult.create({
        customerId,
        examId,
        attemptNumber: nextNumber,
        startedAt: now,
        submittedAt: null,
        inProgress: true,
        status: false,
        total: 0,
        attempt: 0,
        skip: 0,
        success: 0,
        failed: 0,
        score: 0,
        timing: "00:00",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        attemptId: attempt._id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        serverNow: now,
        durationMinutes: exam.durationMinutes,
        questionCount: exam.questionCount,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/quizzes/:id/attempts/:attemptId/answer
// Body: { questionId, answerId? }   (answerId omitted/null => skip)
export const saveSingleAnswer = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { id: examId, attemptId } = req.params as { id: string; attemptId: string };
    if (!isObjectId(examId) || !isObjectId(attemptId))
      return res.status(400).json({ success: false, message: "Invalid exam or attempt id." });

    const data = saveSingleAnswerSchema.parse(req.body);

    const attempt = await ExamResult.findOne({ _id: attemptId, customerId, examId });
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    if (attempt.status === true)
      return res.status(400).json({ success: false, message: "Attempt already submitted." });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    if (isAttemptExpired(attempt, exam.durationMinutes))
      return res.status(400).json({ success: false, message: "Attempt has expired. Please submit." });

    const question = await ExamQuestion.findOne({ _id: data.questionId, examId });
    if (!question) return res.status(400).json({ success: false, message: "Question does not belong to exam." });

    let result: ExamResultType;
    let point = 0;
    let answerId: string | null = null;

    if (!data.answerId) {
      result = ExamResultType.SKIP;
    } else {
      const option = await ExamQuestionOption.findOne({ _id: data.answerId, questionId: data.questionId });
      if (!option)
        return res.status(400).json({ success: false, message: "Answer does not belong to question." });
      answerId = String(option._id);
      if (norm(option.name) === "skip") {
        result = ExamResultType.SKIP;
      } else if (norm(option.name) === norm(question.answer)) {
        result = ExamResultType.TRUE;
        point = exam.positiveMarks;
      } else {
        result = ExamResultType.FALSE;
        point = -Math.abs(exam.negativeMarks);
      }
    }

    await ExamResultDetail.updateOne(
      { examResultId: attempt._id, questionId: data.questionId },
      {
        $set: {
          examResultId: attempt._id,
          customerId,
          examId,
          questionId: data.questionId,
          answerId,
          result,
          point,
        },
      },
      { upsert: true }
    );

    return res.status(200).json({ success: true, data: { saved: true } });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/client/quizzes/:id/attempts/:attemptId/submit
// Body: { timing?, ratting? }   Scores from saved details; unanswered => SKIP.
export const submitAttempt = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { id: examId, attemptId } = req.params as { id: string; attemptId: string };
    if (!isObjectId(examId) || !isObjectId(attemptId))
      return res.status(400).json({ success: false, message: "Invalid exam or attempt id." });

    const data = submitAttemptSchema.parse(req.body ?? {});

    const attempt = await ExamResult.findOne({ _id: attemptId, customerId, examId });
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    if (attempt.status === true)
      return res.status(400).json({ success: false, message: "Attempt already submitted." });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const questions = await ExamQuestion.find({ examId, status: true }).select("_id");
    const allQIds = questions.map((q) => String(q._id));
    const total = allQIds.length;

    const saved = await ExamResultDetail.find({ examResultId: attempt._id });
    const savedByQ = new Map<string, any>();
    for (const d of saved) savedByQ.set(String(d.questionId), d);

    let skip = 0, success = 0, failed = 0, score = 0;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const qid of allQIds) {
          const existing = savedByQ.get(qid);
          if (!existing) {
            await ExamResultDetail.updateOne(
              { examResultId: attempt._id, questionId: qid },
              {
                $set: {
                  examResultId: attempt._id,
                  customerId,
                  examId,
                  questionId: qid,
                  answerId: null,
                  result: ExamResultType.SKIP,
                  point: 0,
                },
              },
              { upsert: true, session }
            );
            skip += 1;
          } else {
            if (existing.result === ExamResultType.SKIP) skip += 1;
            else if (existing.result === ExamResultType.TRUE) success += 1;
            else failed += 1;
            score += existing.point ?? 0;
          }
        }

        const submittedAt = new Date();
        const computedTiming =
          data.timing ??
          (() => {
            const ms = submittedAt.getTime() - new Date(attempt.startedAt as any).getTime();
            const totalSec = Math.max(0, Math.floor(ms / 1000));
            const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
            const s = String(totalSec % 60).padStart(2, "0");
            return `${m}:${s}`;
          })();

        await ExamResult.updateOne(
          { _id: attempt._id },
          {
            $set: {
              total,
              attempt: total - skip,
              skip,
              success,
              failed,
              score: Math.round(score * 100) / 100,
              timing: computedTiming,
              ratting: data.ratting ?? attempt.ratting ?? null,
              status: true,
              inProgress: false,
              submittedAt,
            },
          },
          { session }
        );
      });
    } finally {
      session.endSession();
    }

    await recomputeAnalytics(customerId);

    const finalResult = await ExamResult.findById(attempt._id);

    // Rank by each customer's best score for this exam.
    const bestPerUser = await ExamResult.aggregate([
      { $match: { examId: new mongoose.Types.ObjectId(examId), status: true } },
      { $group: { _id: "$customerId", best: { $max: "$score" } } },
    ]);
    const myBest = Math.max(
      finalResult!.score,
      ...bestPerUser.filter((u: any) => String(u._id) === String(customerId)).map((u: any) => u.best)
    );
    const higher = bestPerUser.filter((u: any) => u.best > myBest).length;
    const totalCandidates = bestPerUser.length;
    const rank = higher + 1;

    return res.status(200).json({
      success: true,
      data: { examResult: finalResult, rank: `${rank}/${totalCandidates}` },
    });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/:id/attempts
// Lists all of this user's attempts for an exam (history list).
export const listAttempts = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const exam = await Exam.findById(examId).select("title type durationMinutes");
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const attempts = await ExamResult.find({ customerId, examId })
      .sort({ attemptNumber: -1 })
      .select("_id attemptNumber total attempt skip success failed score timing status inProgress startedAt submittedAt createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        exam: { _id: exam._id, title: exam.title, type: (exam as any).type, durationMinutes: exam.durationMinutes },
        attempts,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/:id/attempts/aggregate
// Aggregate stats across ALL of this user's submitted attempts for the exam.
// Powers the donut + summary on the Exam Analytics screen.
export const getAttemptsAggregate = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const exam = await Exam.findById(examId).select("title questionCount durationMinutes");
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const cid = new mongoose.Types.ObjectId(customerId);
    const eid = new mongoose.Types.ObjectId(examId);

    const [agg] = await ExamResult.aggregate([
      { $match: { customerId: cid, examId: eid, status: true } },
      {
        $group: {
          _id: null,
          attemptsCount: { $sum: 1 },
          total: { $sum: "$total" },
          attempt: { $sum: "$attempt" },
          skip: { $sum: "$skip" },
          success: { $sum: "$success" },
          failed: { $sum: "$failed" },
          scoreSum: { $sum: "$score" },
          bestScore: { $max: "$score" },
          lastSubmittedAt: { $max: "$submittedAt" },
        },
      },
      {
        $project: {
          _id: 0,
          attemptsCount: 1,
          total: 1,
          attempt: 1,
          skip: 1,
          success: 1,
          failed: 1,
          scoreSum: { $round: ["$scoreSum", 2] },
          bestScore: { $round: ["$bestScore", 2] },
          avgScore: {
            $cond: [
              { $gt: ["$attemptsCount", 0] },
              { $round: [{ $divide: ["$scoreSum", "$attemptsCount"] }, 2] },
              0,
            ],
          },
          accuracy: {
            $cond: [
              { $gt: ["$total", 0] },
              { $round: [{ $multiply: [{ $divide: ["$success", "$total"] }, 100] }, 2] },
              0,
            ],
          },
          lastSubmittedAt: 1,
        },
      },
    ]);

    const summary = agg ?? {
      attemptsCount: 0,
      total: 0,
      attempt: 0,
      skip: 0,
      success: 0,
      failed: 0,
      scoreSum: 0,
      bestScore: 0,
      avgScore: 0,
      accuracy: 0,
      lastSubmittedAt: null,
    };

    // Rank by best score across users.
    const bestPerUser = await ExamResult.aggregate([
      { $match: { examId: eid, status: true } },
      { $group: { _id: "$customerId", best: { $max: "$score" } } },
    ]);
    const myBest = bestPerUser.find((u: any) => String(u._id) === String(customerId))?.best ?? 0;
    const higher = bestPerUser.filter((u: any) => u.best > myBest).length;
    const totalCandidates = bestPerUser.length;

    return res.status(200).json({
      success: true,
      data: {
        exam: { _id: exam._id, title: exam.title, questionCount: exam.questionCount },
        summary,
        rank: totalCandidates > 0 ? `${higher + 1}/${totalCandidates}` : "-",
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/quizzes/:id/attempts/active
export const getActiveAttempt = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Please select valid exam!!" });

    const attempt = await ExamResult.findOne({ customerId, examId, status: false });
    if (!attempt)
      return res.status(200).json({ success: true, data: null });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const details = await ExamResultDetail.find({ examResultId: attempt._id })
      .select("questionId answerId result")
      .lean();

    const now = new Date();
    const expired = isAttemptExpired(attempt, exam.durationMinutes);

    return res.status(200).json({
      success: true,
      data: {
        attemptId: attempt._id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        serverNow: now,
        durationMinutes: exam.durationMinutes,
        expired,
        savedAnswers: details.map((d: any) => ({
          questionId: d.questionId,
          answerId: d.answerId,
        })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
