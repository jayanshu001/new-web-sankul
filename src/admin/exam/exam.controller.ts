import { Request, Response } from "express";
import mongoose from "mongoose";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { ExamQuestion } from "../../models/exam/ExamQuestion.model";
import { ExamQuestionOption } from "../../models/exam/ExamQuestionOption.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamResultDetail } from "../../models/exam/ExamResultDetail.model";
import { ExamResultDetailAnalytics } from "../../models/exam/ExamResultDetailAnalytics.model";
import { ExamStatus, ExamResultType } from "../../models/enums";
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

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// ─── Exam Categories ──────────────────────────────────────────────────────────

export const getCategories = async (req: Request, res: Response) => {
  try {
    const { parentId, search, status } = req.query as Record<string, string>;
    const filter: any = {};
    if (parentId === "root" || parentId === "null") filter.parentId = null;
    else if (parentId && isObjectId(parentId)) filter.parentId = parentId;
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
    if (!isObjectId(id))
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
  if (!isObjectId(parentId)) return [];
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
    if (!isObjectId(id))
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
    if (!isObjectId(id))
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
    if (categoryId && isObjectId(categoryId)) filter.categoryId = categoryId;
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (isPaid === "true" || isPaid === "false") filter.isPaid = isPaid === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
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
    if (!isObjectId(id))
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
    if (!isObjectId(id))
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
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    await session.withTransaction(async () => {
      const qIds = await ExamQuestion.find({ examId: id }, { _id: 1 }, { session });
      const questionIds = qIds.map((q) => q._id);
      if (questionIds.length) {
        await ExamQuestionOption.deleteMany({ questionId: { $in: questionIds } }, { session });
      }
      await ExamQuestion.deleteMany({ examId: id }, { session });
      await ExamResultDetail.deleteMany({ examId: id }, { session });
      await ExamResult.deleteMany({ examId: id }, { session });
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
    if (!isObjectId(id))
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
    const ops = orders
      .filter((o) => isObjectId(o.id))
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
// Options live in a separate collection. Correctness uses ExamQuestion.answer text match.

function validateAnswerAmongOptions(answer: string, options: { name: string }[]) {
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const match = options.find((o) => norm(o.name) === norm(answer));
  if (!match)
    return "The `answer` value must match one of the option `name`s.";
  return null;
}

export const getQuestions = async (req: Request, res: Response) => {
  try {
    const { examId, search, status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const filter: any = {};
    if (examId && isObjectId(examId)) filter.examId = examId;
    if (search) filter.title = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [questions, total] = await Promise.all([
      ExamQuestion.find(filter).sort({ orderBy: 1, createdAt: 1 }).skip(skip).limit(limitNum).lean(),
      ExamQuestion.countDocuments(filter),
    ]);

    const qIds = questions.map((q: any) => q._id);
    const options = await ExamQuestionOption.find({ questionId: { $in: qIds } })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();
    const optsByQuestion: Record<string, any[]> = {};
    options.forEach((o: any) => {
      (optsByQuestion[String(o.questionId)] ||= []).push(o);
    });
    const decorated = questions.map((q: any) => ({
      ...q,
      options: optsByQuestion[String(q._id)] || [],
    }));

    return res.status(200).json({
      success: true,
      data: decorated,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const q = await ExamQuestion.findById(id).lean();
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    const options = await ExamQuestionOption.find({ questionId: id })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();
    return res.status(200).json({ success: true, data: { ...q, options } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const data = createQuestionSchema.parse(req.body);
    if (!isObjectId(data.examId)) {
      return res.status(400).json({ success: false, message: "Invalid examId." });
    }
    const exam = await Exam.findById(data.examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const err = validateAnswerAmongOptions(data.answer, data.options);
    if (err) return res.status(400).json({ success: false, message: err });

    let created: any;
    await session.withTransaction(async () => {
      const [q] = await ExamQuestion.create(
        [
          {
            examId: data.examId,
            title: data.title,
            answer: data.answer,
            image: data.image ?? null,
            solutionText: data.solutionText ?? null,
            solutionImage: data.solutionImage ?? null,
            orderBy: data.orderBy ?? 0,
            status: data.status ?? true,
          },
        ],
        { session }
      );
      const optionDocs = data.options.map((o, idx) => ({
        questionId: q._id,
        name: o.name,
        image: o.image ?? null,
        orderBy: o.orderBy ?? idx,
      }));
      const insertedOptions = await ExamQuestionOption.insertMany(optionDocs, { session });
      created = { ...q.toObject(), options: insertedOptions };
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const bulkCreateQuestions = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const { examId, questions } = bulkCreateQuestionsSchema.parse(req.body);
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid examId." });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    for (const q of questions) {
      const err = validateAnswerAmongOptions(q.answer, q.options);
      if (err)
        return res.status(400).json({ success: false, message: `Question "${q.title.slice(0, 40)}": ${err}` });
    }

    const created: any[] = [];
    await session.withTransaction(async () => {
      for (const q of questions) {
        const [doc] = await ExamQuestion.create(
          [
            {
              examId,
              title: q.title,
              answer: q.answer,
              image: q.image ?? null,
              solutionText: q.solutionText ?? null,
              solutionImage: q.solutionImage ?? null,
              orderBy: q.orderBy ?? 0,
              status: q.status ?? true,
            },
          ],
          { session }
        );
        const optionDocs = q.options.map((o, idx) => ({
          questionId: doc._id,
          name: o.name,
          image: o.image ?? null,
          orderBy: o.orderBy ?? idx,
        }));
        const insertedOptions = await ExamQuestionOption.insertMany(optionDocs, { session });
        created.push({ ...doc.toObject(), options: insertedOptions });
      }
    });
    return res.status(201).json({ success: true, data: created, count: created.length });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const data = updateQuestionSchema.parse(req.body);

    // If both options + answer updated, validate match. If only answer, validate against existing options.
    if (data.options || data.answer !== undefined) {
      const options =
        data.options ??
        (await ExamQuestionOption.find({ questionId: id })
          .select("name")
          .lean());
      const answer =
        data.answer ??
        (await ExamQuestion.findById(id).select("answer").lean())?.answer ??
        "";
      const err = validateAnswerAmongOptions(answer, options as any);
      if (err) return res.status(400).json({ success: false, message: err });
    }

    let updated: any;
    await session.withTransaction(async () => {
      const update: any = { ...data };
      delete update.options;
      const q = await ExamQuestion.findByIdAndUpdate(id, { $set: update }, { new: true, session });
      if (!q) throw new Error("Question not found.");

      if (data.options) {
        await ExamQuestionOption.deleteMany({ questionId: id }, { session });
        const docs = data.options.map((o: any, idx: number) => ({
          questionId: id,
          name: o.name,
          image: o.image ?? null,
          orderBy: o.orderBy ?? idx,
        }));
        await ExamQuestionOption.insertMany(docs, { session });
      }

      const options = await ExamQuestionOption.find({ questionId: id })
        .sort({ orderBy: 1 })
        .lean({ session } as any);
      updated = { ...q.toObject(), options };
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.message === "Question not found.")
      return res.status(404).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });

    let found: any = null;
    await session.withTransaction(async () => {
      found = await ExamQuestion.findByIdAndDelete(id, { session });
      if (!found) return;
      await ExamQuestionOption.deleteMany({ questionId: id }, { session });
      await ExamResultDetail.deleteMany({ questionId: id }, { session });
    });
    if (!found) return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, message: "Question deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const reorderQuestions = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderQuestionsSchema.parse(req.body);
    const ops = orders
      .filter((o) => isObjectId(o.id))
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

// GET /api/v1/admin/exams/:examId/submissions
export const getExamSubmissions = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { examId };
    const [data, total] = await Promise.all([
      ExamResult.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
        .sort({ score: -1, updatedAt: 1 })
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

// GET /api/v1/admin/exams/:examId/analytics
export const getExamAnalytics = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const oid = new mongoose.Types.ObjectId(examId);

    const overall = await ExamResult.aggregate([
      { $match: { examId: oid } },
      {
        $group: {
          _id: null,
          totalCandidates: { $sum: 1 },
          avgScore: { $avg: "$score" },
          maxScore: { $max: "$score" },
          minScore: { $min: "$score" },
          avgAccuracy: {
            $avg: {
              $cond: [
                { $gt: ["$total", 0] },
                { $multiply: [{ $divide: ["$success", "$total"] }, 100] },
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalCandidates: 1,
          avgScore: { $round: ["$avgScore", 2] },
          maxScore: 1,
          minScore: 1,
          avgAccuracy: { $round: ["$avgAccuracy", 2] },
        },
      },
    ]);

    const perQuestion = await ExamResultDetail.aggregate([
      { $match: { examId: oid } },
      {
        $group: {
          _id: "$questionId",
          total: { $sum: 1 },
          correct: { $sum: { $cond: [{ $eq: ["$result", ExamResultType.TRUE] }, 1, 0] } },
          wrong: { $sum: { $cond: [{ $eq: ["$result", ExamResultType.FALSE] }, 1, 0] } },
          skipped: { $sum: { $cond: [{ $eq: ["$result", ExamResultType.SKIP] }, 1, 0] } },
        },
      },
      {
        $lookup: {
          from: "ws_exam_question",
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

// GET /api/v1/admin/exams/results/:id — fetch one ExamResult with details
export const getResultById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid result id." });
    const result = await ExamResult.findById(id)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
      .populate("examId", "_id title type durationMinutes");
    if (!result) return res.status(404).json({ success: false, message: "Result not found." });
    const details = await ExamResultDetail.find({ examResultId: id }).lean();
    return res.status(200).json({ success: true, data: { result, details } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/v1/admin/exams/results/:id/invalidate — zero out a result (retains row)
export const invalidateResult = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid result id." });
    const result = await ExamResult.findByIdAndUpdate(
      id,
      { $set: { status: false, score: 0 } },
      { new: true }
    );
    if (!result) return res.status(404).json({ success: false, message: "Result not found." });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exams/analytics/customer/:customerId — lifetime aggregates
export const getCustomerAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    if (!isObjectId(customerId))
      return res.status(400).json({ success: false, message: "Invalid customer id." });
    const analytics = await ExamResultDetailAnalytics.findOne({ customerId });
    return res.status(200).json({ success: true, data: analytics });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
