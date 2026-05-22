import { Request, Response } from "express";
import mongoose from "mongoose";
import { ExamCountdown } from "../../models/examCountdown/ExamCountdown.model";
import { ExamCountdownCategory } from "../../models/examCountdown/ExamCountdownCategory.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const MS_PER_DAY = 86_400_000;

// UTC midnight of "now" — anchor for daysLeft math (timezone-stable).
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysLeft(examDate: Date): number {
  const exam = new Date(
    Date.UTC(examDate.getUTCFullYear(), examDate.getUTCMonth(), examDate.getUTCDate())
  );
  return Math.ceil((exam.getTime() - todayUTC().getTime()) / MS_PER_DAY);
}

function shapeRow(doc: any) {
  const cat = doc.categoryId;
  return {
    _id: doc._id,
    title: doc.title,
    examDate: doc.examDate,
    daysLeft: daysLeft(doc.examDate),
    category:
      cat && typeof cat === "object" && cat._id
        ? { _id: cat._id, name: cat.name, colorHex: cat.colorHex }
        : null,
  };
}

// GET /client/exam-countdowns/categories
export const listCategories = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listCategories invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await ExamCountdownCategory.find({ status: true })
      .sort({ order: 1, name: 1 })
      .select("_id name colorHex order")
      .lean();
    logger.info("listCategories success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("listCategories failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdowns?categoryId=&search=&page=1&limit=20&includePast=false
export const listCountdowns = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCountdowns invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const {
      categoryId,
      search = "",
      page = "1",
      limit = "20",
      includePast = "false",
    } = req.query as Record<string, string>;

    const filter: any = { status: true };
    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        logger.warn("listCountdowns invalid categoryId", { traceId, categoryId });
        return res.status(400).json({ success: false, message: "Invalid categoryId." });
      }
      filter.categoryId = categoryId;
    }
    if (search.trim()) filter.title = { $regex: search.trim(), $options: "i" };
    if (includePast !== "true") filter.examDate = { $gte: todayUTC() };

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      ExamCountdown.find(filter)
        .populate("categoryId", "_id name colorHex")
        .sort({ examDate: 1, order: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ExamCountdown.countDocuments(filter),
    ]);

    logger.info("listCountdowns success", { traceId, total });
    return res.status(200).json({
      success: true,
      data: docs.map(shapeRow),
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listCountdowns failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdowns/upcoming?limit=5
export const upcomingCountdowns = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("upcomingCountdowns invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const requested = parseInt((req.query.limit as string) ?? "5", 10) || 5;
    const limitNum = Math.min(Math.max(requested, 1), 20);

    const docs = await ExamCountdown.find({ status: true, examDate: { $gte: todayUTC() } })
      .populate("categoryId", "_id name colorHex")
      .sort({ examDate: 1, order: 1 })
      .limit(limitNum)
      .lean();

    logger.info("upcomingCountdowns success", { traceId, count: docs.length });
    return res.status(200).json({ success: true, data: docs.map(shapeRow) });
  } catch (error: any) {
    logger.error("upcomingCountdowns failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
