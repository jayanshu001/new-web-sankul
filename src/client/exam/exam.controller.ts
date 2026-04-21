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
import { saveAnswersSchema, rateResultSchema } from "./exam.validation";

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
      .select("_id title description type isPaid durationMinutes questionCount positiveMarks negativeMarks startAt endAt language difficulty orderBy")
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
        .lean();
      for (const r of results) resultByExam.set(String(r.examId), r);
    }

    const decorated = exams.map((e: any) => ({
      ...e.toObject(),
      lastResult: resultByExam.get(String(e._id)) ?? null,
    }));

    return res.status(200).json({ success: true, data: { subjects, exams: decorated } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/exams/daily
export const getDailyExams = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

    const exams = await Exam.find({
      type: ExamType.DAILY,
      status: ExamStatus.PUBLISHED,
      startAt: { $lte: endOfDay },
      $or: [{ endAt: { $gte: startOfDay } }, { endAt: null }],
    })
      .select("_id title description durationMinutes questionCount positiveMarks negativeMarks startAt endAt orderBy language")
      .sort({ startAt: 1 });

    let resultByExam = new Map<string, any>();
    if (customerId && exams.length) {
      const results = await ExamResult.find({
        customerId,
        examId: { $in: exams.map((e) => e._id) },
        status: true,
      }).select("examId score timing updatedAt");
      for (const r of results) resultByExam.set(String(r.examId), r);
    }

    const decorated = exams.map((e: any) => ({
      ...e.toObject(),
      lastResult: resultByExam.get(String(e._id)) ?? null,
    }));

    return res.status(200).json({ success: true, data: decorated });
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
        examResult = await ExamResult.findOneAndUpdate(
          { customerId, examId: data.examId },
          {
            $set: {
              customerId,
              examId: data.examId,
              total,
              attempt,
              skip,
              success,
              failed,
              score: Math.round(score * 100) / 100,
              timing: data.timing,
              ratting: data.ratting ?? null,
              status: true,
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true, session }
        );

        for (const d of details) {
          await ExamResultDetail.updateOne(
            { customerId, examId: data.examId, questionId: d.questionId },
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

    const higher = await ExamResult.countDocuments({
      examId: data.examId,
      score: { $gt: examResult.score },
      status: true,
    });
    const totalCandidates = await ExamResult.countDocuments({ examId: data.examId, status: true });
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

    const details = await ExamResultDetail.find({ customerId, examId })
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
          answer: norm(q.answer) === norm(o.name),
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

    const examResult: any = await ExamResult.findOne({ customerId, examId }).lean();
    if (!examResult)
      return res.status(404).json({ success: false, message: "No result found for this exam." });

    const accuracy =
      examResult.total > 0 ? (examResult.success * 100) / examResult.total : 0;

    const higher = await ExamResult.countDocuments({
      examId,
      score: { $gt: examResult.score },
      status: true,
    });
    const totalCandidates = await ExamResult.countDocuments({ examId, status: true });

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

    return res.status(501).json({
      success: false,
      message: "PDF generation not yet wired. See generateExamSolutionPdf utility (pending).",
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
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
