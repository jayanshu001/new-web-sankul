import { Request, Response } from "express";
import { Types } from "mongoose";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Exam } from "../../models/exam/Exam.model";
import { ExamStatus } from "../../models/enums";
import { Material } from "../../models/course/Material.model";
import { Video } from "../../models/course/Video.model";

// Resolve category ids reachable through any free package OR free course.
export async function resolveFreeCategoryIds() {
  const [freePackages, freeCourses] = await Promise.all([
    Package.find({ active: true, isPaid: false })
      .select("_id materialCategories examCategories specificSubjects")
      .lean(),
    Course.find({ status: true, isPaid: false })
      .select("_id materialCategories examCategories videoCategoryId")
      .lean(),
  ]);

  const materialCategoryIds = new Set<string>();
  const examCategoryIds = new Set<string>();
  const videoCategoryIds = new Set<string>();

  for (const p of freePackages as any[]) {
    for (const ref of p.materialCategories ?? []) {
      if (ref.status !== false && ref.category) materialCategoryIds.add(String(ref.category));
    }
    for (const ref of p.examCategories ?? []) {
      if (ref.status !== false && ref.category) examCategoryIds.add(String(ref.category));
    }
  }

  for (const c of freeCourses as any[]) {
    for (const ref of c.materialCategories ?? []) {
      if (ref.category) materialCategoryIds.add(String(ref.category));
    }
    for (const ref of c.examCategories ?? []) {
      if (ref.category) examCategoryIds.add(String(ref.category));
    }
    if (c.videoCategoryId) videoCategoryIds.add(String(c.videoCategoryId));
  }

  // Videos can also be reached via PackageVideoCategoryRelation → VideoCategoryRelation
  if (freePackages.length) {
    const pkgIds = freePackages.map((p: any) => p._id);
    const relations = await PackageVideoCategoryRelation.find({
      packageId: { $in: pkgIds },
      active: true,
    })
      .select("videoCategoryRelationId")
      .lean();

    if (relations.length) {
      const relIds = relations.map((r: any) => r.videoCategoryRelationId);
      const vcRelations = await VideoCategoryRelation.find({ _id: { $in: relIds } })
        .select("parent child")
        .lean();
      for (const r of vcRelations as any[]) {
        if (r.parent) videoCategoryIds.add(String(r.parent));
        if (r.child) videoCategoryIds.add(String(r.child));
      }
    }
  }

  return {
    materialCategoryIds: Array.from(materialCategoryIds).map((id) => new Types.ObjectId(id)),
    examCategoryIds: Array.from(examCategoryIds).map((id) => new Types.ObjectId(id)),
    videoCategoryIds: Array.from(videoCategoryIds).map((id) => new Types.ObjectId(id)),
  };
}

function paginate(req: Request) {
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
}

// GET /api/v1/client/free-tests
export const listFreeTests = async (req: Request, res: Response) => {
  try {
    const { search } = req.query as Record<string, string>;
    const { examCategoryIds } = await resolveFreeCategoryIds();
    const { pageNum, limitNum, skip } = paginate(req);

    const filter: any = { status: ExamStatus.PUBLISHED, categoryId: { $in: examCategoryIds } };
    if (search) filter.title = { $regex: search, $options: "i" };

    if (!examCategoryIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
      });
    }

    const [data, total] = await Promise.all([
      Exam.find(filter)
        .populate("categoryId", "_id title image")
        .sort({ orderBy: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Exam.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-materials
export const listFreeMaterials = async (req: Request, res: Response) => {
  try {
    const { search } = req.query as Record<string, string>;
    const { materialCategoryIds } = await resolveFreeCategoryIds();
    const { pageNum, limitNum, skip } = paginate(req);

    const filter: any = { status: true, materialCategoryId: { $in: materialCategoryIds } };
    if (search) filter.title = { $regex: search, $options: "i" };

    if (!materialCategoryIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
      });
    }

    const [data, total] = await Promise.all([
      Material.find(filter)
        .populate("materialCategoryId", "_id title image")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Material.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-videos
export const listFreeVideos = async (req: Request, res: Response) => {
  try {
    const { search } = req.query as Record<string, string>;
    const { videoCategoryIds } = await resolveFreeCategoryIds();
    const { pageNum, limitNum, skip } = paginate(req);

    const filter: any = { status: true, videoCategoryId: { $in: videoCategoryIds } };
    if (search) filter.title = { $regex: search, $options: "i" };

    if (!videoCategoryIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
      });
    }

    const [data, total] = await Promise.all([
      Video.find(filter)
        .populate("videoCategoryId", "_id title image")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Video.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
