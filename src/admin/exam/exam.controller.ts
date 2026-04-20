import { Request, Response } from "express";
import mongoose from "mongoose";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { ExamQuestion } from "../../models/exam/ExamQuestion.model";
import { ExamAttempt } from "../../models/exam/ExamAttempt.model";
import { ExamStatus, ExamQuestionType, ExamAttemptStatus, ExamResultType } from "../../models/enums";
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

// ─── Exam Categories ──────────────────────────────────────────────────────────

export const getCategories = async (req: Request, res: Response) => {
  try {
    const { parentId, search, status } = req.query as Record<string, string>;
    const filter: any = {};
    if (parentId === "root" || parentId === "null") filter.parentId = null;
    else if (parentId && mongoose.Types.ObjectId.isValid(parentId)) filter.parentId = parentId;
    if (search) filter.name = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const categories = await ExamCategory.find(filter).sort({ orderBy: 1, name: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryTree = async (_req: Request, res: Response) => {
  try {
    const all = await ExamCategory.find({ status: true }).sort({ orderBy: 1, name: 1 }).lean();
    const byParent = new Map<string, any[]>();
    all.forEach((c) => {
      const key = c.parentId ? c.parentId.toString() : "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    });
    const attachChildren = (node: any) => {
      const children = byParent.get(node._id.toString()) ?? [];
      node.children = children.map(attachChildren);
      return node;
    };
    const roots = (byParent.get("root") ?? []).map(attachChildren);
    return res.status(200).json({ success: true, data: roots });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const cat = await ExamCategory.findById(id);
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data: cat });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

async function buildAncestors(parentId?: string | null): Promise<mongoose.Types.ObjectId[]> {
  if (!parentId) return [];
  if (!mongoose.Types.ObjectId.isValid(parentId)) return [];
  const parent = await ExamCategory.findById(parentId).select("_id ancestors");
  if (!parent) return [];
  return [...(parent.ancestors || []), parent._id];
}

export const createCategory = async (req: Request, res: Response) => {
  try {
    const data = createCategorySchema.parse(req.body);
    const ancestors = await buildAncestors(data.parentId ?? null);
    const cat = await ExamCategory.create({
      ...data,
      parentId: data.parentId ?? null,
      ancestors,
    });
    return res.status(201).json({ success: true, data: cat });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const data = updateCategorySchema.parse(req.body);
    const update: any = { ...data };
    if (data.parentId !== undefined) {
      if (data.parentId === id) {
        return res.status(400).json({ success: false, message: "Category cannot be its own parent." });
      }
      update.parentId = data.parentId || null;
      update.ancestors = await buildAncestors(data.parentId);
    }
    const cat = await ExamCategory.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data: cat });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const childCount = await ExamCategory.countDocuments({ parentId: id });
    if (childCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Category has sub-categories. Delete or reassign them first.",
      });
    }
    const examCount = await Exam.countDocuments({ categoryId: id });
    if (examCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Category has exams. Reassign or delete them first.",
      });
    }
    const cat = await ExamCategory.findByIdAndDelete(id);
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
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

    const filter: any = {};
    if (search) filter.title = { $regex: search, $options: "i" };
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) filter.categoryId = categoryId;
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (isPaid === "true" || isPaid === "false") filter.isPaid = isPaid === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Exam.find(filter)
        .populate("categoryId", "_id name")
        .sort({ orderBy: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Exam.countDocuments(filter),
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

export const getExamById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    const exam = await Exam.findById(id).populate("categoryId", "_id name");
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    const questionCount = await ExamQuestion.countDocuments({ examId: id });
    return res.status(200).json({ success: true, data: { ...exam.toObject(), actualQuestionCount: questionCount } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createExam = async (req: Request, res: Response) => {
  try {
    const data = createExamSchema.parse(req.body);
    if (data.startAt && data.endAt && new Date(data.startAt) >= new Date(data.endAt)) {
      return res.status(400).json({ success: false, message: "endAt must be after startAt." });
    }
    const payload: any = {
      ...data,
      categoryId: data.categoryId || null,
      startAt: data.startAt ? new Date(data.startAt) : undefined,
      endAt: data.endAt ? new Date(data.endAt) : undefined,
    };
    const exam = await Exam.create(payload);
    return res.status(201).json({ success: true, data: exam });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateExam = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    const data = updateExamSchema.parse(req.body);
    if (data.startAt && data.endAt && new Date(data.startAt) >= new Date(data.endAt)) {
      return res.status(400).json({ success: false, message: "endAt must be after startAt." });
    }
    const update: any = { ...data };
    if (data.categoryId !== undefined) update.categoryId = data.categoryId || null;
    if (data.startAt) update.startAt = new Date(data.startAt);
    if (data.endAt) update.endAt = new Date(data.endAt);
    const exam = await Exam.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, data: exam });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteExam = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    await session.withTransaction(async () => {
      await ExamQuestion.deleteMany({ examId: id }, { session });
      await ExamAttempt.deleteMany({ examId: id }, { session });
      await Exam.findByIdAndDelete(id, { session });
    });

    return res.status(200).json({ success: true, message: "Exam and related data deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateExamStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    const { status } = req.body as { status: ExamStatus };
    if (!Object.values(ExamStatus).includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value." });
    }
    const exam = await Exam.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, data: exam });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderExams = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderExamsSchema.parse(req.body);
    const orderBys = new Set(orders.map((o) => o.orderBy));
    if (orderBys.size !== orders.length) {
      return res.status(400).json({ success: false, message: "Duplicate orderBy values." });
    }
    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } } }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await Exam.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Exam order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Questions ────────────────────────────────────────────────────────────────

function validateQuestionOptions(options: any[], type: ExamQuestionType) {
  const correctCount = options.filter((o) => o.isCorrect).length;
  if (type === ExamQuestionType.SINGLE && correctCount !== 1) {
    return "Single-choice question must have exactly one correct option.";
  }
  if (type === ExamQuestionType.MULTI && correctCount < 1) {
    return "Multi-choice question must have at least one correct option.";
  }
  return null;
}

export const getQuestions = async (req: Request, res: Response) => {
  try {
    const { examId, search, status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const filter: any = {};
    if (examId && mongoose.Types.ObjectId.isValid(examId)) filter.examId = examId;
    if (search) filter.title = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 50, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      ExamQuestion.find(filter).sort({ orderBy: 1, createdAt: 1 }).skip(skip).limit(limitNum),
      ExamQuestion.countDocuments(filter),
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

export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const q = await ExamQuestion.findById(id);
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, data: q });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  try {
    const data = createQuestionSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(data.examId)) {
      return res.status(400).json({ success: false, message: "Invalid examId." });
    }
    const exam = await Exam.findById(data.examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const err = validateQuestionOptions(data.options, data.type);
    if (err) return res.status(400).json({ success: false, message: err });

    const q = await ExamQuestion.create(data);
    return res.status(201).json({ success: true, data: q });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkCreateQuestions = async (req: Request, res: Response) => {
  try {
    const { examId, questions } = bulkCreateQuestionsSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(examId))
      return res.status(400).json({ success: false, message: "Invalid examId." });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    for (const q of questions) {
      const err = validateQuestionOptions(q.options, q.type);
      if (err) return res.status(400).json({ success: false, message: `Question "${q.title.slice(0, 40)}": ${err}` });
    }

    const payload = questions.map((q) => ({ ...q, examId }));
    const created = await ExamQuestion.insertMany(payload);
    return res.status(201).json({ success: true, data: created, count: created.length });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const data = updateQuestionSchema.parse(req.body);

    if (data.options) {
      const type = data.type ?? ExamQuestionType.SINGLE;
      const err = validateQuestionOptions(data.options, type);
      if (err) return res.status(400).json({ success: false, message: err });
    }

    const q = await ExamQuestion.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, data: q });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const q = await ExamQuestion.findByIdAndDelete(id);
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, message: "Question deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderQuestions = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderQuestionsSchema.parse(req.body);
    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } } }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await ExamQuestion.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Question order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Submissions / Analytics ──────────────────────────────────────────────────

export const getExamSubmissions = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    if (!mongoose.Types.ObjectId.isValid(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter = { examId, status: ExamAttemptStatus.SUBMITTED };
    const [data, total] = await Promise.all([
      ExamAttempt.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
        .sort({ score: -1, submittedAt: 1 })
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

export const getExamAnalytics = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    if (!mongoose.Types.ObjectId.isValid(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const overall = await ExamAttempt.aggregate([
      {
        $match: {
          examId: new mongoose.Types.ObjectId(examId),
          status: ExamAttemptStatus.SUBMITTED,
        },
      },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          uniqueCandidates: { $addToSet: "$customerId" },
          avgScore: { $avg: "$score" },
          maxScore: { $max: "$score" },
          minScore: { $min: "$score" },
          avgAccuracy: { $avg: "$accuracy" },
        },
      },
      {
        $project: {
          _id: 0,
          totalAttempts: 1,
          uniqueCandidates: { $size: "$uniqueCandidates" },
          avgScore: { $round: ["$avgScore", 2] },
          maxScore: 1,
          minScore: 1,
          avgAccuracy: { $round: ["$avgAccuracy", 2] },
        },
      },
    ]);

    // Per-question accuracy
    const perQuestion = await ExamAttempt.aggregate([
      {
        $match: {
          examId: new mongoose.Types.ObjectId(examId),
          status: ExamAttemptStatus.SUBMITTED,
        },
      },
      { $unwind: "$answers" },
      {
        $group: {
          _id: "$answers.questionId",
          total: { $sum: 1 },
          correct: {
            $sum: { $cond: [{ $eq: ["$answers.result", ExamResultType.TRUE] }, 1, 0] },
          },
          wrong: {
            $sum: { $cond: [{ $eq: ["$answers.result", ExamResultType.FALSE] }, 1, 0] },
          },
          skipped: {
            $sum: { $cond: [{ $eq: ["$answers.result", ExamResultType.SKIP] }, 1, 0] },
          },
        },
      },
      {
        $lookup: {
          from: "ws_exam_questions",
          localField: "_id",
          foreignField: "_id",
          as: "question",
        },
      },
      { $unwind: { path: "$question", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          questionTitle: "$question.title",
          total: 1,
          correct: 1,
          wrong: 1,
          skipped: 1,
          accuracy: {
            $cond: [
              { $eq: ["$total", 0] },
              0,
              { $round: [{ $multiply: [{ $divide: ["$correct", "$total"] }, 100] }, 2] },
            ],
          },
        },
      },
      { $sort: { accuracy: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      data: { overall: overall[0] ?? null, perQuestion },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAttemptById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid attempt id." });
    const attempt = await ExamAttempt.findById(id)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
      .populate("examId", "_id title type");
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    return res.status(200).json({ success: true, data: attempt });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const invalidateAttempt = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid attempt id." });
    const attempt = await ExamAttempt.findByIdAndUpdate(
      id,
      { $set: { status: ExamAttemptStatus.ABANDONED, score: 0, accuracy: 0 } },
      { new: true }
    );
    if (!attempt) return res.status(404).json({ success: false, message: "Attempt not found." });
    return res.status(200).json({ success: true, data: attempt });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
