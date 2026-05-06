import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Material } from "../../models/course/Material.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCountdownCategory } from "../../models/examCountdown/ExamCountdownCategory.model";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Book } from "../../models/book/Book.model";
import { Ebook } from "../../models/ebook/Ebook.model";

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

// GET /client/exam-countdown-categories/:id/packages
export const listPackagesByExamCountdownCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const category = await ExamCountdownCategory.findById(id).lean();
    if (!category)
      return res.status(404).json({ success: false, message: "Exam countdown category not found." });

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { examCountdownCategoryId: id, active: true };
    if (search) filter.name = { $regex: search, $options: "i" };

    const [packages, total] = await Promise.all([
      Package.find(filter)
        .populate("packageTypeId", "_id name")
        .populate("goalId", "_id title")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Package.countDocuments(filter),
    ]);

    const list = await Promise.all(
      packages.map(async (p) => {
        const [plans, subCount] = await Promise.all([
          PackageCourseEbookPrice.find({ packageId: p._id, status: true }).sort({ duration: 1 }),
          PackageCourseSubscription.countDocuments({ packageId: p._id, status: true }),
        ]);
        return {
          ...p.toObject(),
          plans: {
            withMaterial: plans.filter((pl) => pl.withMaterial),
            withoutMaterial: plans.filter((pl) => !pl.withMaterial),
          },
          subscriberCount: subCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown-categories/:id/books-ebooks
// Returns books + ebooks merged into a single `list`, each row tagged with `type`.
export const listBooksAndEbooksByExamCountdownCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const category = await ExamCountdownCategory.findById(id).lean();
    if (!category)
      return res.status(404).json({ success: false, message: "Exam countdown category not found." });

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { examCountdownCategoryId: id, status: true };
    if (search) filter.name = { $regex: search, $options: "i" };

    const [books, ebooks] = await Promise.all([
      Book.find(filter).lean(),
      Ebook.find(filter).lean(),
    ]);

    const merged = [
      ...books.map((b) => ({ ...b, type: "book" as const })),
      ...ebooks.map((e) => ({ ...e, type: "ebook" as const })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
    );

    const total = merged.length;
    const list = merged.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
