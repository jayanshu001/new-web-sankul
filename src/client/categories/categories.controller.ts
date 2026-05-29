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
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { generateToken, generateKey, generateVector, encrypt } from "../../utils/videoEncryption";
import { resolveVideoSource } from "../../utils/videoResolver";
import { defaultListingQualities, qualitiesFromSessionRecordings } from "../../utils/videoQualities";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

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

// Streamos historically delivered some recording paths with stray quote
// characters (raw `"`, URL-encoded `%22`, or `%2522`) tacked onto the end of
// the URL — an upstream JSON-quoting bug. Strip defensively so the client
// never sees an unplayable URL. Mirrors the helper in live-course.controller.
function sanitizeRecordingPath<T extends string | null | undefined>(p: T): T {
  if (typeof p !== "string") return p;
  return p.replace(/(?:"|%22|%2522)+$/i, "") as T;
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
    bitrate: p.bitrate,
    hasAudio: p.hasAudio,
    hasVideo: p.hasVideo,
    url: encrypt(p.url, key, vector),
  }));

  // Wrapped under `request.files` per the FE contract (mapLessonItem reads
  // request.files.progressive / request.files.token). The extra nesting is
  // load-bearing — don't flatten it.
  return {
    request: {
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
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listVideosByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listVideosByCategory invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const category = await VideoCategory.findById(id).lean();
    if (!category) {
      logger.warn("listVideosByCategory category not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Video category not found." });
    }

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { videoCategoryId: id, status: true };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [rawList, total] = await Promise.all([
      Video.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Video.countDocuments(filter),
    ]);

    // Per-video resume state — lets the FE render the red progress sliver
    // and "X% watched" / completed checkmark on each row. Null if the user
    // has never started that video (or isn't logged in).
    const userId = req.user?.id;
    let progressByVideo = new Map<string, any>();
    if (userId && rawList.length) {
      const progressRows = await LectureProgress.find({
        customerId: new mongoose.Types.ObjectId(userId),
        videoId: { $in: rawList.map((v: any) => v._id) },
      })
        .select("videoId positionSec durationSec completed completedAt lastWatchedAt")
        .lean();
      progressByVideo = new Map(progressRows.map((r: any) => [String(r.videoId), r]));
    }

    // Multi-quality MP4/m3u8 recordings live on the source LiveSession (Streamos
    // returns multiple tiers per stream). Videos promoted from a live recording
    // carry a `liveSessionId` back-link; batch-fetch the sessions and surface
    // the per-quality array on the row so the FE can offer a resolution
    // switcher / download size estimate without hitting the detail endpoint.
    // Manually-uploaded videos (no liveSessionId) get [] and use the synthetic
    // standard ladder for `qualities` instead.
    const liveSessionIds = rawList
      .map((v: any) => v.liveSessionId)
      .filter((id: any): id is mongoose.Types.ObjectId => !!id);
    let recordingsBySession = new Map<string, Array<{ quality: string | null; file_size: number | null; path: string }>>();
    if (liveSessionIds.length) {
      const sessions = await LiveSession.find({ _id: { $in: liveSessionIds } })
        .select("_id recordings")
        .lean();
      for (const s of sessions as any[]) {
        const shaped = (s.recordings ?? [])
          .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
          .map((r: any) => ({
            quality: typeof r.quality === "string" ? r.quality : null,
            file_size: typeof r.file_size === "number" ? r.file_size : null,
            path: sanitizeRecordingPath(r.path),
          }));
        recordingsBySession.set(String(s._id), shaped);
      }
    }

    const list = rawList.map((v: any) => {
      const shaped = shapeVideoForList(v);
      const p = progressByVideo.get(String(v._id));
      const recordings = v.liveSessionId
        ? recordingsBySession.get(String(v.liveSessionId)) ?? []
        : [];
      // Prefer qualities derived from the actual recordings ladder when we have
      // it; otherwise fall back to the synthetic 4-tier ladder so the FE picker
      // still renders something useful for manually-uploaded videos.
      const qualities = recordings.length
        ? qualitiesFromSessionRecordings(recordings)
        : defaultListingQualities();
      return {
        ...shaped,
        progress: p
          ? {
              positionSec: p.positionSec ?? 0,
              durationSec: p.durationSec ?? 0,
              completed: !!p.completed,
              completedAt: p.completedAt ?? null,
              lastWatchedAt: p.lastWatchedAt ?? null,
            }
          : null,
        recordings,
        qualities,
      };
    });

    logger.info("listVideosByCategory success", { traceId, categoryId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listVideosByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/video-categories/:id/videos/:videoId
// Resolves a single recorded video through ytdl-core (YouTube) or VideoCrypt
// (AWS) and returns the encrypted multi-resolution envelope. The list endpoint
// stays metadata-only; this is the detail call the FE makes on row tap.
export const getVideoByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("getVideoByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, videoId, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(videoId)) {
      logger.warn("getVideoByCategory invalid ids", { traceId, categoryId: id, videoId });
      return res.status(422).json({ success: false, message: "Invalid category or video id." });
    }

    const video = await Video.findOne({ _id: videoId, videoCategoryId: id, status: true }).lean();
    if (!video) {
      logger.warn("getVideoByCategory video not found", { traceId, categoryId: id, videoId });
      return res.status(404).json({ success: false, message: "Video not found in this category." });
    }

    let envelope;
    try {
      envelope = await encryptVideoEnvelope(video);
    } catch (err: any) {
      logger.error("getVideoByCategory resolve/encrypt failed", {
        traceId,
        videoId,
        platform: video.platform,
        error: err?.message,
        stack: err?.stack,
      });
      return res.status(502).json({
        success: false,
        message: "Failed to resolve playable URLs for this video.",
      });
    }

    logger.info("getVideoByCategory success", { traceId, categoryId: id, videoId, platform: video.platform });
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
    logger.error("getVideoByCategory failed", { traceId, categoryId: id, videoId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/material-categories/:id/materials
export const listMaterialsByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listMaterialsByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listMaterialsByCategory invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const category = await MaterialCategory.findById(id).lean();
    if (!category) {
      logger.warn("listMaterialsByCategory category not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Material category not found." });
    }

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { materialCategoryId: id, status: true };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [list, total] = await Promise.all([
      Material.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Material.countDocuments(filter),
    ]);

    logger.info("listMaterialsByCategory success", { traceId, categoryId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMaterialsByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-categories/:id/exams
export const listExamsByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listExamsByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listExamsByCategory invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const category = await ExamCategory.findById(id).lean();
    if (!category) {
      logger.warn("listExamsByCategory category not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Exam category not found." });
    }

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { categoryId: id };
    if (search) filter.title = { $regex: search, $options: "i" };

    const [list, total] = await Promise.all([
      Exam.find(filter).sort({ orderBy: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Exam.countDocuments(filter),
    ]);

    logger.info("listExamsByCategory success", { traceId, categoryId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listExamsByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
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
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listVideoCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listVideoCategoryChildren invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const parent: any = await VideoCategory.findById(id).lean();
    if (!parent) {
      logger.warn("listVideoCategoryChildren parent not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Video category not found." });
    }

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

    logger.info("listVideoCategoryChildren success", { traceId, categoryId: id, childCount: list.length });
    return res.status(200).json({ success: true, data: { parent, list } });
  } catch (error: any) {
    logger.error("listVideoCategoryChildren failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/material-categories/:id/children
export const listMaterialCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listMaterialCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listMaterialCategoryChildren invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const parent: any = await MaterialCategory.findById(id).lean();
    if (!parent) {
      logger.warn("listMaterialCategoryChildren parent not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Material category not found." });
    }

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

    logger.info("listMaterialCategoryChildren success", { traceId, categoryId: id, childCount: list.length });
    return res.status(200).json({ success: true, data: { parent, list } });
  } catch (error: any) {
    logger.error("listMaterialCategoryChildren failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-categories/:id/children
export const listExamCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listExamCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listExamCategoryChildren invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const parent: any = await ExamCategory.findById(id).lean();
    if (!parent) {
      logger.warn("listExamCategoryChildren parent not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Exam category not found." });
    }

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

    logger.info("listExamCategoryChildren success", { traceId, categoryId: id, childCount: list.length });
    return res.status(200).json({ success: true, data: { parent, list } });
  } catch (error: any) {
    logger.error("listExamCategoryChildren failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown-categories/:id/packages
export const listPackagesByExamCountdownCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listPackagesByExamCountdownCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listPackagesByExamCountdownCategory invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const category = await ExamCountdownCategory.findById(id).lean();
    if (!category) {
      logger.warn("listPackagesByExamCountdownCategory category not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Exam countdown category not found." });
    }

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { examCountdownCategoryIds: id, active: true };
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

    logger.info("listPackagesByExamCountdownCategory success", { traceId, categoryId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listPackagesByExamCountdownCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown-categories/:id/books-ebooks
// Returns books + ebooks merged into a single `list`, each row tagged with `type`.
export const listBooksAndEbooksByExamCountdownCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listBooksAndEbooksByExamCountdownCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listBooksAndEbooksByExamCountdownCategory invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }

    const category = await ExamCountdownCategory.findById(id).lean();
    if (!category) {
      logger.warn("listBooksAndEbooksByExamCountdownCategory category not found", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Exam countdown category not found." });
    }

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

    logger.info("listBooksAndEbooksByExamCountdownCategory success", { traceId, categoryId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { category, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listBooksAndEbooksByExamCountdownCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Package Categories ──────────────────────────────────────────────────────
import { PackageCategory } from "../../models/course/PackageCategory.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";

export const listPackageCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveOnly = String(req.query.live ?? "").toLowerCase() === "true";
  logger.info("listPackageCategories invoked", { traceId, path: req.originalUrl, liveOnly });

  try {
    const categories = await PackageCategory.find({ status: true }).sort({ order: 1 }).lean();

    if (!liveOnly) {
      logger.info("listPackageCategories success", { traceId, count: categories.length, liveOnly });
      return res.status(200).json({ success: true, data: categories });
    }

    // ?live=true → keep only categories that have ≥1 active LiveCourse.
    const categoryIds = categories.map((c: any) => c._id);
    const liveCategoryIds = await LiveCourse.distinct("packageCategoryId", {
      status: true,
      packageCategoryId: { $in: categoryIds },
    });
    const liveSet = new Set(liveCategoryIds.map((x: any) => String(x)));
    const filtered = categories.filter((c: any) => liveSet.has(String(c._id)));

    logger.info("listPackageCategories success", { traceId, count: filtered.length, liveOnly });
    return res.status(200).json({ success: true, data: filtered });
  } catch (error: any) {
    logger.error("listPackageCategories failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackagesByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { id } = req.params as { id: string };
  logger.info("listPackagesByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listPackagesByCategory invalid id", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid package category id" });
    }

    const [packages, liveCourses] = await Promise.all([
      Package.find({ active: true, packageCategoryId: id })
        .select(
          "_id name description image shareableLink order isPaid isMagazine isSmartCourse isPlannerCourse withMaterialText withoutMaterialText packageTypeId goalId educatorId"
        )
        .sort({ order: 1 })
        .lean(),
      LiveCourse.find({ status: true, packageCategoryId: id })
        .select(
          "_id name description image shareableLink ordered isPaid isPopular level classType withMaterial withoutMaterial courseEducatorId"
        )
        .sort({ ordered: 1 })
        .lean(),
    ]);

    const packageIds = packages.map((p) => p._id);
    const plans = packageIds.length
      ? await PackageCourseEbookPrice.find({
          packageId: { $in: packageIds },
          status: true,
        })
          .select("_id packageId name duration price withMaterial materialPrice isDefault")
          .lean()
      : [];

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

    const recorded = packages.map((p) => {
      const pkgPlans = plansByPackage.get(String(p._id)) ?? [];
      const defaultPlan = pkgPlans.find((pl) => pl.isDefault) ?? pkgPlans[0] ?? null;
      return {
        ...p,
        plans: pkgPlans,
        defaultPlan,
        startingPrice: defaultPlan ? defaultPlan.price : null,
      };
    });

    logger.info("listPackagesByCategory success", {
      traceId,
      categoryId: id,
      recordedCount: recorded.length,
      liveCount: liveCourses.length,
    });
    return res.status(200).json({ success: true, data: { recorded, live: liveCourses } });
  } catch (error: any) {
    logger.error("listPackagesByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

