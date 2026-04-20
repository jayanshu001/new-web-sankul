import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { ExamQuestion } from "../../models/exam/ExamQuestion.model";
import { ExamAttempt } from "../../models/exam/ExamAttempt.model";
import {
  ExamStatus,
  ExamAttemptStatus,
  ExamResultType,
  ExamQuestionType,
} from "../../models/enums";
import { autosaveAnswersSchema, submitAttemptSchema } from "./exam.validation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeQuestionForTaking(q: any) {
  return {
    _id: q._id,
    title: q.title,
    image: q.image,
    type: q.type,
    orderBy: q.orderBy,
    options: (q.options ?? []).map((opt: any) => ({
      _id: opt._id,
      text: opt.text,
      image: opt.image,
    })),
  };
}

async function loadActiveAttempt(customerId: string, examId: string) {
  return ExamAttempt.findOne({
    customerId,
    examId,
    status: ExamAttemptStatus.IN_PROGRESS,
  });
}

function getPoints(
  exam: { positiveMarks: number; negativeMarks: number },
  question: { positiveMarksOverride?: number | null; negativeMarksOverride?: number | null },
  result: ExamResultType
): number {
  if (result === ExamResultType.SKIP) return 0;
  if (result === ExamResultType.TRUE) {
    return question.positiveMarksOverride ?? exam.positiveMarks;
  }
  return -Math.abs(question.negativeMarksOverride ?? exam.negativeMarks);
}

function evaluateAnswer(
  question: { type: string; options: { _id: Types.ObjectId; isCorrect: boolean }[] },
  selectedOptionIds: string[]
): ExamResultType {
  if (!selectedOptionIds || selectedOptionIds.length === 0) return ExamResultType.SKIP;

  const selectedSet = new Set(selectedOptionIds.map(String));
  const correctIds = question.options.filter((o) => o.isCorrect).map((o) => o._id.toString());
  const correctSet = new Set(correctIds);

  if (question.type === ExamQuestionType.MULTI) {
    if (selectedSet.size !== correctSet.size) return ExamResultType.FALSE;
    for (const id of selectedSet) if (!correctSet.has(id)) return ExamResultType.FALSE;
    return ExamResultType.TRUE;
  }
  // single-choice
  if (selectedSet.size !== 1) return ExamResultType.FALSE;
  const [only] = selectedSet;
  return correctSet.has(only) ? ExamResultType.TRUE : ExamResultType.FALSE;
}

// ─── Category Browsing ────────────────────────────────────────────────────────

export const listCategories = async (req: Request, res: Response) => {
  try {
    const { parentId } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (!parentId || parentId === "root") filter.parentId = null;
    else if (mongoose.Types.ObjectId.isValid(parentId)) filter.parentId = parentId;

    const categories = await ExamCategory.find(filter)
      .select("_id name image parentId orderBy")
      .sort({ orderBy: 1, name: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listExamsByCategory = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const categoryId = req.params.categoryId as string;
    if (!mongoose.Types.ObjectId.isValid(categoryId))
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

    let lastAttemptByExam = new Map<string, any>();
    if (customerId && exams.length) {
      const examIds = exams.map((e) => e._id);
      const attempts = await ExamAttempt.find({
        customerId,
        examId: { $in: examIds },
        status: ExamAttemptStatus.SUBMITTED,
      })
        .sort({ submittedAt: -1 })
        .select("examId score accuracy submittedAt totalQuestions correct wrong skipped");
      for (const a of attempts) {
        const k = a.examId.toString();
        if (!lastAttemptByExam.has(k)) lastAttemptByExam.set(k, a);
      }
    }

    const decoratedExams = exams.map((e) => ({
      ...e.toObject(),
      lastAttempt: lastAttemptByExam.get(e._id.toString()) ?? null,
    }));

    return res.status(200).json({
      success: true,
      data: { subjects, exams: decoratedExams },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDailyExams = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const exams = await Exam.find({
      type: "daily",
      status: ExamStatus.PUBLISHED,
      startAt: { $lte: endOfDay },
      $or: [{ endAt: { $gte: startOfDay } }, { endAt: null }],
    })
      .select("_id title description durationMinutes questionCount positiveMarks negativeMarks startAt endAt orderBy language")
      .sort({ startAt: 1 });

    let lastAttemptByExam = new Map<string, any>();
    if (customerId && exams.length) {
      const attempts = await ExamAttempt.find({
        customerId,
        examId: { $in: exams.map((e) => e._id) },
        status: ExamAttemptStatus.SUBMITTED,
      })
        .sort({ submittedAt: -1 })
        .select("examId score accuracy submittedAt");
      for (const a of attempts) {
        const k = a.examId.toString();
        if (!lastAttemptByExam.has(k)) lastAttemptByExam.set(k, a);
      }
    }

    const result = exams.map((e) => ({
      ...e.toObject(),
      lastAttempt: lastAttemptByExam.get(e._id.toString()) ?? null,
    }));

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Exam Detail ──────────────────────────────────────────────────────────────

export const getExamDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const exam = await Exam.findOne({ _id: id, status: ExamStatus.PUBLISHED });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found or not published." });

    return res.status(200).json({ success: true, data: exam });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Attempt Lifecycle ────────────────────────────────────────────────────────

export const startAttempt = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const exam = await Exam.findOne({ _id: examId, status: ExamStatus.PUBLISHED });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found or not published." });

    const now = new Date();
    if (exam.startAt && now < exam.startAt) {
      return res.status(400).json({ success: false, message: "Exam has not started yet." });
    }
    if (exam.endAt && now > exam.endAt) {
      return res.status(400).json({ success: false, message: "Exam has ended." });
    }

    // If an attempt is already in progress, return it.
    const existing = await loadActiveAttempt(customerId, examId);
    if (existing) {
      if (existing.deadlineAt < now) {
        existing.status = ExamAttemptStatus.EXPIRED;
        await existing.save();
      } else {
        return res.status(200).json({ success: true, data: existing, resumed: true });
      }
    }

    const questionCount = await ExamQuestion.countDocuments({ examId, status: true });
    if (questionCount === 0) {
      return res.status(400).json({ success: false, message: "Exam has no questions." });
    }

    const attemptCount = await ExamAttempt.countDocuments({ customerId, examId });
    const attempt = await ExamAttempt.create({
      customerId,
      examId,
      attemptNumber: attemptCount + 1,
      status: ExamAttemptStatus.IN_PROGRESS,
      startedAt: now,
      deadlineAt: new Date(now.getTime() + exam.durationMinutes * 60 * 1000),
      totalQuestions: questionCount,
      answers: [],
    });

    return res.status(201).json({ success: true, data: attempt, resumed: false });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAttemptQuestions = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    const attemptId = req.params.attemptId as string;
    if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(attemptId))
      return res.status(400).json({ success: false, message: "Invalid ids." });

    const attempt = await ExamAttempt.findOne({ _id: attemptId, customerId, examId });
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
      return res.status(400).json({ success: false, message: "Attempt is not active." });
    }

    const questions = await ExamQuestion.find({ examId, status: true })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();

    const sanitized = questions.map(sanitizeQuestionForTaking);

    // Map already-saved answers by questionId
    const answerMap = new Map<string, string[]>();
    for (const a of attempt.answers) {
      answerMap.set(
        a.questionId.toString(),
        (a.selectedOptionIds ?? []).map((o) => o.toString())
      );
    }

    const decorated = sanitized.map((q) => ({
      ...q,
      selectedOptionIds: answerMap.get(q._id.toString()) ?? [],
    }));

    const remainingSeconds = Math.max(
      0,
      Math.floor((attempt.deadlineAt.getTime() - Date.now()) / 1000)
    );

    return res.status(200).json({
      success: true,
      data: {
        attemptId: attempt._id,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        remainingSeconds,
        questions: decorated,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const autosaveAnswers = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const attemptId = req.params.attemptId as string;
    if (!mongoose.Types.ObjectId.isValid(attemptId))
      return res.status(400).json({ success: false, message: "Invalid attempt id." });

    const { answers } = autosaveAnswersSchema.parse(req.body);

    const attempt = await ExamAttempt.findOne({ _id: attemptId, customerId });
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
      return res.status(400).json({ success: false, message: "Attempt is not active." });
    }
    if (attempt.deadlineAt < new Date()) {
      attempt.status = ExamAttemptStatus.EXPIRED;
      await attempt.save();
      return res.status(400).json({ success: false, message: "Attempt has expired." });
    }

    const now = new Date();
    const map = new Map(attempt.answers.map((a) => [a.questionId.toString(), a]));
    for (const incoming of answers) {
      if (!mongoose.Types.ObjectId.isValid(incoming.questionId)) continue;
      const existing = map.get(incoming.questionId);
      const selected = incoming.selectedOptionIds
        .filter((s) => mongoose.Types.ObjectId.isValid(s))
        .map((s) => new Types.ObjectId(s));
      if (existing) {
        existing.selectedOptionIds = selected;
        existing.answeredAt = now;
      } else {
        attempt.answers.push({
          questionId: new Types.ObjectId(incoming.questionId),
          selectedOptionIds: selected,
          result: ExamResultType.SKIP,
          points: 0,
          answeredAt: now,
        });
      }
    }
    await attempt.save();

    return res.status(200).json({ success: true, message: "Answers saved." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const submitAttempt = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const examId = req.params.id as string;
    const attemptId = req.params.attemptId as string;
    if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(attemptId))
      return res.status(400).json({ success: false, message: "Invalid ids." });

    const { answers: finalAnswers } = submitAttemptSchema.parse(req.body);

    const attempt = await ExamAttempt.findOne({ _id: attemptId, customerId, examId });
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
      return res.status(400).json({ success: false, message: "Attempt is not active." });
    }

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const now = new Date();
    const expired = attempt.deadlineAt < now;

    // Merge any final client-side answers on top of autosaved state.
    const map = new Map(attempt.answers.map((a) => [a.questionId.toString(), a]));
    for (const incoming of finalAnswers) {
      if (!mongoose.Types.ObjectId.isValid(incoming.questionId)) continue;
      const selected = incoming.selectedOptionIds
        .filter((s) => mongoose.Types.ObjectId.isValid(s))
        .map((s) => new Types.ObjectId(s));
      const existing = map.get(incoming.questionId);
      if (existing) existing.selectedOptionIds = selected;
      else
        attempt.answers.push({
          questionId: new Types.ObjectId(incoming.questionId),
          selectedOptionIds: selected,
          result: ExamResultType.SKIP,
          points: 0,
          answeredAt: now,
        });
    }

    const questions = await ExamQuestion.find({ examId, status: true });
    const qMap = new Map(questions.map((q) => [q._id.toString(), q]));

    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let score = 0;

    // Evaluate every active question — even missing answers count as skipped.
    const evaluated: typeof attempt.answers = [];
    const attemptAnswerMap = new Map(
      attempt.answers.map((a) => [a.questionId.toString(), a])
    );

    for (const q of questions) {
      const incoming = attemptAnswerMap.get(q._id.toString());
      const selectedIds = incoming?.selectedOptionIds?.map((s) => s.toString()) ?? [];
      const result = evaluateAnswer(q as any, selectedIds);
      const points = getPoints(exam as any, q as any, result);
      if (result === ExamResultType.TRUE) correct += 1;
      else if (result === ExamResultType.FALSE) wrong += 1;
      else skipped += 1;
      score += points;

      evaluated.push({
        questionId: q._id,
        selectedOptionIds:
          incoming?.selectedOptionIds ?? [],
        result,
        points,
        answeredAt: incoming?.answeredAt ?? now,
      });
    }

    const totalQuestions = questions.length;
    const attempted = totalQuestions - skipped;
    const accuracy = totalQuestions > 0 ? (correct * 100) / totalQuestions : 0;

    const elapsedSeconds = Math.min(
      Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000),
      exam.durationMinutes * 60
    );

    attempt.answers = evaluated;
    attempt.totalQuestions = totalQuestions;
    attempt.correct = correct;
    attempt.wrong = wrong;
    attempt.skipped = skipped;
    attempt.attempted = attempted;
    attempt.score = Math.max(0, Math.round(score * 100) / 100);
    attempt.accuracy = Math.round(accuracy * 100) / 100;
    attempt.elapsedSeconds = elapsedSeconds;
    attempt.submittedAt = now;
    attempt.status = expired ? ExamAttemptStatus.SUBMITTED : ExamAttemptStatus.SUBMITTED;
    // (We still mark as SUBMITTED if expired so the user sees their result, but you
    // could choose EXPIRED instead depending on policy.)

    await attempt.save();

    // Compute rank within this exam (latest attempt per customer).
    const [totalCandidatesAgg, higherScorersAgg] = await Promise.all([
      ExamAttempt.aggregate([
        {
          $match: {
            examId: new mongoose.Types.ObjectId(examId),
            status: ExamAttemptStatus.SUBMITTED,
          },
        },
        { $group: { _id: "$customerId", bestScore: { $max: "$score" } } },
        { $count: "total" },
      ]),
      ExamAttempt.aggregate([
        {
          $match: {
            examId: new mongoose.Types.ObjectId(examId),
            status: ExamAttemptStatus.SUBMITTED,
          },
        },
        { $group: { _id: "$customerId", bestScore: { $max: "$score" } } },
        { $match: { bestScore: { $gt: attempt.score } } },
        { $count: "higher" },
      ]),
    ]);

    const totalCandidates = totalCandidatesAgg[0]?.total ?? 1;
    const higher = higherScorersAgg[0]?.higher ?? 0;
    const rank = higher + 1;

    attempt.rank = rank;
    attempt.totalCandidates = totalCandidates;
    await attempt.save();

    return res.status(200).json({
      success: true,
      data: {
        attempt,
        rank: `${rank}/${totalCandidates}`,
      },
    });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Post-Submit Views ────────────────────────────────────────────────────────

export const getAttemptSolution = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const attemptId = req.params.attemptId as string;
    if (!mongoose.Types.ObjectId.isValid(attemptId))
      return res.status(400).json({ success: false, message: "Invalid attempt id." });

    const attempt = await ExamAttempt.findOne({ _id: attemptId, customerId });
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    if (attempt.status !== ExamAttemptStatus.SUBMITTED) {
      return res.status(400).json({ success: false, message: "Attempt not submitted yet." });
    }

    const questions = await ExamQuestion.find({ examId: attempt.examId, status: true })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();

    const answerMap = new Map(
      attempt.answers.map((a) => [a.questionId.toString(), a])
    );

    const solution = questions.map((q) => {
      const userAnswer = answerMap.get(q._id.toString());
      const selectedSet = new Set(
        (userAnswer?.selectedOptionIds ?? []).map((s) => s.toString())
      );
      return {
        _id: q._id,
        title: q.title,
        image: q.image,
        type: q.type,
        solutionText: q.solutionText,
        solutionImage: q.solutionImage,
        options: (q.options ?? []).map((opt: any) => ({
          _id: opt._id,
          text: opt.text,
          image: opt.image,
          isCorrect: !!opt.isCorrect,
          isSelected: selectedSet.has(opt._id.toString()),
        })),
        result: userAnswer?.result ?? ExamResultType.SKIP,
        points: userAnswer?.points ?? 0,
      };
    });

    return res.status(200).json({ success: true, data: { attempt, solution } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAttemptAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const attemptId = req.params.attemptId as string;
    if (!mongoose.Types.ObjectId.isValid(attemptId))
      return res.status(400).json({ success: false, message: "Invalid attempt id." });

    const attempt = await ExamAttempt.findOne({ _id: attemptId, customerId })
      .populate("examId", "_id title durationMinutes positiveMarks negativeMarks");
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });

    return res.status(200).json({
      success: true,
      data: {
        attempt,
        rank: attempt.rank && attempt.totalCandidates ? `${attempt.rank}/${attempt.totalCandidates}` : null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listMyAttempts = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { page = "1", limit = "20", examId } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { customerId, status: ExamAttemptStatus.SUBMITTED };
    if (examId && mongoose.Types.ObjectId.isValid(examId)) filter.examId = examId;

    const [data, total] = await Promise.all([
      ExamAttempt.find(filter)
        .populate("examId", "_id title type durationMinutes positiveMarks negativeMarks")
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      ExamAttempt.countDocuments(filter),
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

export const getMyOverallAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const agg = await ExamAttempt.aggregate([
      {
        $match: {
          customerId: new mongoose.Types.ObjectId(customerId),
          status: ExamAttemptStatus.SUBMITTED,
        },
      },
      {
        $group: {
          _id: null,
          exams: { $addToSet: "$examId" },
          totalAttempts: { $sum: 1 },
          questions: { $sum: "$totalQuestions" },
          attempted: { $sum: "$attempted" },
          skipped: { $sum: "$skipped" },
          correct: { $sum: "$correct" },
          wrong: { $sum: "$wrong" },
          score: { $sum: "$score" },
          avgAccuracy: { $avg: "$accuracy" },
        },
      },
      {
        $project: {
          _id: 0,
          totalExams: { $size: "$exams" },
          totalAttempts: 1,
          questions: 1,
          attempted: 1,
          skipped: 1,
          correct: 1,
          wrong: 1,
          score: { $round: ["$score", 2] },
          avgAccuracy: { $round: ["$avgAccuracy", 2] },
        },
      },
    ]);

    return res.status(200).json({ success: true, data: agg[0] ?? null });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
