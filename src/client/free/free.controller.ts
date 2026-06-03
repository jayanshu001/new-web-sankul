import { Request, Response } from "express";
import { Types } from "mongoose";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Exam } from "../../models/exam/Exam.model";
import { ExamStatus } from "../../models/enums";
import { Material } from "../../models/course/Material.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Video } from "../../models/course/Video.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

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
  const traceId = req.traceId;
  logger.info("listFreeTests invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { examCategoryIds } = await resolveFreeCategoryIds();
    const { pageNum, limitNum, skip } = paginate(req);

    // "Free" = reachable via a free category OR explicitly marked isPaid:false.
    // Guard the per-item branch with categoryId !== null so the schema default
    // (isPaid:false) on orphan/uncategorised exams can't leak the whole catalog.
    const filter: any = {
      status: ExamStatus.PUBLISHED,
      $or: [
        { categoryId: { $in: examCategoryIds } },
        { isPaid: false, categoryId: { $ne: null } },
      ],
    };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [data, total] = await Promise.all([
      Exam.find(filter)
        .populate("categoryId", "_id title image")
        .sort({ orderBy: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Exam.countDocuments(filter),
    ]);

    logger.info("listFreeTests success", { traceId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeTests failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-materials
// Optional query: materialCategoryId — when the client taps a category card,
// it passes the id and only materials under that category are returned.
export const listFreeMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeMaterials invoked", { traceId, path: req.originalUrl, userId: req.user?.id, materialCategoryId: req.query.materialCategoryId });

  try {
    const { search, materialCategoryId } = req.query as Record<string, string>;
    const { materialCategoryIds } = await resolveFreeCategoryIds();
    const { pageNum, limitNum, skip } = paginate(req);

    // If client filtered to a single category, intersect it with the
    // free-reachable set so a paid category id can't leak free materials.
    let effectiveIds = materialCategoryIds;
    if (materialCategoryId && Types.ObjectId.isValid(materialCategoryId)) {
      const reqId = String(materialCategoryId);
      effectiveIds = materialCategoryIds.filter((id) => String(id) === reqId);
    }

    const filter: any = { status: true, materialCategoryId: { $in: effectiveIds } };
    if (search) filter.title = { $regex: search, $options: "i" };

    if (!effectiveIds.length) {
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

    logger.info("listFreeMaterials success", { traceId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeMaterials failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-materials/grouped
// Two-level tree for the Free Materials screen: each free course/package
// becomes a section, and inside it are the material categories the user can
// open. lessonCount is the number of active materials in that category that
// belong to this parent's free-reachable set.
export const listFreeMaterialsGrouped = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listFreeMaterialsGrouped invoked", { traceId, path: _req.originalUrl });

  try {
    const [freePackages, freeCourses] = await Promise.all([
      Package.find({ active: true, isPaid: false })
        .select("_id name materialCategories")
        .lean(),
      Course.find({ status: true, isPaid: false })
        .select("_id name materialCategories")
        .lean(),
    ]);

    type Parent = { _id: any; name: string; type: "course" | "package"; categoryIds: any[] };
    const parents: Parent[] = [];

    for (const p of freePackages as any[]) {
      const ids = (p.materialCategories ?? [])
        .filter((r: any) => r.status !== false && r.category)
        .map((r: any) => r.category);
      if (ids.length) parents.push({ _id: p._id, name: p.name, type: "package", categoryIds: ids });
    }
    for (const c of freeCourses as any[]) {
      const ids = (c.materialCategories ?? [])
        .filter((r: any) => r.category)
        .map((r: any) => r.category);
      if (ids.length) parents.push({ _id: c._id, name: c.name, type: "course", categoryIds: ids });
    }

    const allCategoryIds = Array.from(
      new Set(parents.flatMap((p) => p.categoryIds.map((id: any) => String(id))))
    ).map((id) => new Types.ObjectId(id));

    if (!allCategoryIds.length) {
      logger.info("listFreeMaterialsGrouped empty", { traceId });
      return res.status(200).json({ success: true, data: [] });
    }

    const [categories, counts] = await Promise.all([
      MaterialCategory.find({ _id: { $in: allCategoryIds }, status: true })
        .select("_id title image")
        .lean(),
      Material.aggregate([
        { $match: { status: true, materialCategoryId: { $in: allCategoryIds } } },
        { $group: { _id: "$materialCategoryId", n: { $sum: 1 } } },
      ]),
    ]);

    const categoryById = new Map<string, any>(categories.map((c: any) => [String(c._id), c]));
    const countById = new Map<string, number>(counts.map((c: any) => [String(c._id), c.n]));

    const data = parents
      .map((p) => ({
        _id: p._id,
        name: p.name,
        type: p.type,
        materialCategories: p.categoryIds
          .map((id: any) => {
            const cat = categoryById.get(String(id));
            if (!cat) return null;
            return {
              _id: cat._id,
              title: cat.title,
              image: cat.image,
              lessonCount: countById.get(String(id)) ?? 0,
            };
          })
          .filter(Boolean),
      }))
      .filter((p) => p.materialCategories.length);

    logger.info("listFreeMaterialsGrouped success", { traceId, parentCount: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFreeMaterialsGrouped failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/free-videos
export const listFreeVideos = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFreeVideos invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search } = req.query as Record<string, string>;
    const { videoCategoryIds } = await resolveFreeCategoryIds();
    const { pageNum, limitNum, skip } = paginate(req);

    // "Free" = reachable via a free video category OR the video itself is
    // marked priceType:"free" (the same flag /v1/lecture honours for playback).
    const filter: any = {
      status: true,
      $or: [
        { videoCategoryId: { $in: videoCategoryIds } },
        { priceType: "free" },
      ],
    };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [data, total] = await Promise.all([
      Video.find(filter)
        .populate("videoCategoryId", "_id title image")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Video.countDocuments(filter),
    ]);

    logger.info("listFreeVideos success", { traceId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listFreeVideos failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
