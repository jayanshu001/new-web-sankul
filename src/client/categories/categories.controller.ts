import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Material } from "../../models/course/Material.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { Exam } from "../../models/exam/Exam.model";

function parsePaging(req: Request) {
  const { page = "1", limit = "20", search = "" } = req.query as Record<string, string>;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum, search: search.trim() };
}

// GET /client/video-categories/:id/videos
export const listVideosByCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const category = await VideoCategory.findById(id).lean();
    if (!category)
      return res.status(404).json({ success: false, message: "Video category not found." });

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { videoCategoryId: id, status: true };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [list, total] = await Promise.all([
      Video.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Video.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/material-categories/:id/materials
export const listMaterialsByCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const category = await MaterialCategory.findById(id).lean();
    if (!category)
      return res.status(404).json({ success: false, message: "Material category not found." });

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { materialCategoryId: id, status: true };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [list, total] = await Promise.all([
      Material.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Material.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-categories/:id/exams
export const listExamsByCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const category = await ExamCategory.findById(id).lean();
    if (!category)
      return res.status(404).json({ success: false, message: "Exam category not found." });

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { categoryId: id };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [list, total] = await Promise.all([
      Exam.find(filter).sort({ orderBy: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Exam.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
