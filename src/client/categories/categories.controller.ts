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
import { generateToken, generateKey, generateVector, encrypt } from "../../utils/videoEncryption";
import { resolveVideoSource } from "../../utils/videoResolver";

// Metadata-only row shape. Resolved/playable URLs (ytdl-core / VideoCrypt
// output) are NOT included here — a single category page can hold 20+ videos
// and we don't want to pay 20+ upstream calls per page load. The FE calls the
// detail endpoint (getVideoByCategory) on row tap to get the encrypted envelope.
//
// We DO include youtube_id / aws_id / vimeo_id on each row so the FE can show
// the right thumbnail/label and pass the correct id to whatever native player
// flow it uses. These are just identifiers, not directly-playable URLs.
function shapeVideoForList(v: any) {
  return v;
}

// Same envelope encryptLecture (live-course) produces, ported here so this
// endpoint family also returns the shared {files:{token,hls,progressive}}
// contract. Centralising this in a util later would be ideal, but the duplicated
// copy keeps the two flows independent for now.
async function encryptVideoEnvelope(v: {
  platform: string;
  youtube_id?: string | null;
  aws_id?: string | null;
  vimeo_id?: string | null;
}) {
  const resolved = await resolveVideoSource(v);
  const token = generateToken(16);
  const key = generateKey(token);
  const vector = generateVector(token);

  const progressive = resolved.progressive.map((p) => ({
    qualityLabel: p.qualityLabel,
    quality: p.quality,
    height: p.height,
    url: encrypt(p.url, key, vector),
  }));

  return {
    files: {
      token,
      hls: {
        default_cdn: "primary",
        cdns: {
          primary: {
            url: resolved.hlsUrl ? encrypt(resolved.hlsUrl, key, vector) : "",
            allow720: resolved.allow720,
          },
        },
      },
      progressive,
    },
  };
}

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

    const [rawList, total] = await Promise.all([
      Video.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Video.countDocuments(filter),
    ]);

    const list = rawList.map(shapeVideoForList);

    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/video-categories/:id/videos/:videoId
// Resolves a single recorded video through ytdl-core (YouTube) or VideoCrypt
// (AWS) and returns the encrypted multi-resolution envelope. The list endpoint
// stays metadata-only; this is the detail call the FE makes on row tap.
export const getVideoByCategory = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    const videoId = String(req.params.videoId ?? "");
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(422).json({ success: false, message: "Invalid category or video id." });
    }

    const video = await Video.findOne({ _id: videoId, videoCategoryId: id, status: true }).lean();
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found in this category." });
    }

    let envelope;
    try {
      envelope = await encryptVideoEnvelope(video);
    } catch (err: any) {
      console.error("[video-detail] resolve/encrypt failed", {
        videoId,
        platform: video.platform,
        error: err?.message,
      });
      return res.status(502).json({
        success: false,
        message: "Failed to resolve playable URLs for this video.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        _id: String(video._id),
        title: video.title ?? "",
        topic: video.topic ?? "",
        platform: video.platform,
        priceType: video.priceType,
        ...envelope,
      },
      message: "Video fetched.",
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

// ─── Category children (drill-down) ──────────────────────────────────────────
// All three return { parent, list } where list[].category carries the same
// shape used in the package detail: { ...categoryDoc, havingChildDirectory, count }.
// Use `havingChildDirectory` on the client to decide whether tapping a card
// should drill deeper or open the items list.

// GET /client/video-categories/:id/children
export const listVideoCategoryChildren = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const parent: any = await VideoCategory.findById(id).lean();
    if (!parent)
      return res.status(404).json({ success: false, message: "Video category not found." });

    const childIds = (parent.childCategoryIds || []) as mongoose.Types.ObjectId[];
    const children = childIds.length
      ? await VideoCategory.find({ _id: { $in: childIds }, status: true })
          .sort({ order_by: 1 })
          .lean()
      : [];

    const list = await Promise.all(
      children.map(async (cat: any) => {
        const count = await Video.countDocuments({
          videoCategoryId: cat._id,
          status: true,
        });
        return {
          category: {
            ...cat,
            havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
            count,
          },
        };
      })
    );

    return res.status(200).json({ success: true, data: { parent, list } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/material-categories/:id/children
export const listMaterialCategoryChildren = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const parent: any = await MaterialCategory.findById(id).lean();
    if (!parent)
      return res.status(404).json({ success: false, message: "Material category not found." });

    const childIds = (parent.childCategoryIds || []) as mongoose.Types.ObjectId[];
    const children = childIds.length
      ? await MaterialCategory.find({ _id: { $in: childIds }, status: true })
          .sort({ order: 1 })
          .lean()
      : [];

    const list = await Promise.all(
      children.map(async (cat: any) => {
        const count = await Material.countDocuments({
          materialCategoryId: cat._id,
          status: true,
        });
        return {
          category: {
            ...cat,
            havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
            count,
          },
        };
      })
    );

    return res.status(200).json({ success: true, data: { parent, list } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-categories/:id/children
export const listExamCategoryChildren = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const parent: any = await ExamCategory.findById(id).lean();
    if (!parent)
      return res.status(404).json({ success: false, message: "Exam category not found." });

    const childIds = (parent.childCategoryIds || []) as mongoose.Types.ObjectId[];
    const children = childIds.length
      ? await ExamCategory.find({ _id: { $in: childIds }, status: true })
          .sort({ orderBy: 1 })
          .lean()
      : [];

    const list = await Promise.all(
      children.map(async (cat: any) => {
        const count = await Exam.countDocuments({ categoryId: cat._id });
        return {
          category: {
            ...cat,
            title: (cat as any).name,
            havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
            count,
          },
        };
      })
    );

    return res.status(200).json({ success: true, data: { parent, list } });
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

// ─── Package Categories ──────────────────────────────────────────────────────
import { PackageCategory } from "../../models/course/PackageCategory.model";
import { LiveCourseCategory } from "../../models/course/LiveCourseCategory.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";

export const listPackageCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await PackageCategory.find({ status: true }).sort({ order: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackagesByCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid package category id" });
    }

    const packages = await Package.find({ active: true, packageCategoryId: id })
      .select(
        "_id name description image shareableLink order isPaid isMagazine isSmartCourse isPlannerCourse withMaterialText withoutMaterialText packageTypeId goalId educatorId"
      )
      .sort({ order: 1 })
      .lean();

    const packageIds = packages.map((p) => p._id);
    const plans = await PackageCourseEbookPrice.find({
      packageId: { $in: packageIds },
      status: true,
    })
      .select("_id packageId name duration price withMaterial materialPrice isDefault")
      .lean();

    const plansByPackage = new Map<string, typeof plans>();
    for (const plan of plans) {
      const key = String(plan.packageId);
      if (!plansByPackage.has(key)) plansByPackage.set(key, []);
      plansByPackage.get(key)!.push(plan);
    }
    for (const [, list] of plansByPackage) {
      list.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return (a.duration ?? 0) - (b.duration ?? 0);
      });
    }

    const data = packages.map((p) => {
      const pkgPlans = plansByPackage.get(String(p._id)) ?? [];
      const defaultPlan = pkgPlans.find((pl) => pl.isDefault) ?? pkgPlans[0] ?? null;
      return {
        ...p,
        plans: pkgPlans,
        defaultPlan,
        startingPrice: defaultPlan ? defaultPlan.price : null,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Live Course Categories ──────────────────────────────────────────────────
export const listLiveCourseCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await LiveCourseCategory.find({ status: true }).sort({ order: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listLiveCoursesByCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid live course category id" });
    }
    const liveCourses = await LiveCourse.find({ status: true, liveCourseCategoryId: id })
      .select("_id name image ordered isPaid isPopular classType")
      .sort({ ordered: 1 });
    return res.status(200).json({ success: true, data: liveCourses });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
