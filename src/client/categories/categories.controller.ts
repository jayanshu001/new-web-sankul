import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Material } from "../../models/course/Material.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { collectCategoryTreeIds } from "../../utils/categoryTree";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCountdownCategory } from "../../models/examCountdown/ExamCountdownCategory.model";
import { ExamCountdown } from "../../models/examCountdown/ExamCountdown.model";
import { ExamStatus } from "../../models/enums";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookOrderStatus } from "../../models/enums";
import { purchasedPackageEndAtMap } from "../package/package.controller";
import { getDaysLeftMapForLiveCourses } from "../live-course/entitlement";
import { computeDaysLeft } from "../../utils/planDuration";
import { Book } from "../../models/book/Book.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { collapseProgressByVideo } from "../learning/collapseProgress";
import { resolveVideoScope } from "../course/resolveVideoScope";
import { getPurchasedMaterialIds, shapeMaterialForClient } from "../material/entitlement";
import { LiveSession } from "../../models/course/LiveSession.model";
import { generateToken, generateKey, generateVector, encrypt } from "../../utils/videoEncryption";
import { resolveVideoSource } from "../../utils/videoResolver";
import { defaultListingQualities, qualitiesFromSessionRecordings } from "../../utils/videoQualities";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// Row passthrough. The list now also embeds the encrypted playback envelope
// (`request.files`, see listVideosByCategory) so the FE can download/play
// straight from the list. Resolution is Redis-cached and failure-isolated per
// row, so the page stays resilient even when an individual video can't resolve.
// We also keep youtube_id / aws_id / vimeo_id on each row for thumbnail/label
// and native-player flows — these are identifiers, not directly-playable URLs.
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
    // Optional price filter. `?type=free` → only free videos, `?type=paid` →
    // only paid. Any other value is ignored (no filter). Maps to the Video
    // model's `priceType` field.
    const typeQ = String(req.query.type ?? "").toLowerCase();
    if (typeQ === "free" || typeQ === "paid") filter.priceType = typeQ;

    const [rawList, total, scope] = await Promise.all([
      Video.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Video.countDocuments(filter),
      // The owning container (course / package / live course) the FE must echo
      // back into the progress heartbeat's `scope`. Resolved once per category
      // since every video here shares the same category. `null` for an orphan
      // category linked to no container.
      resolveVideoScope(id),
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

    // Playable URL envelopes, one per row, built in parallel. Each video gets
    // the SAME {request:{files:{token,hls,progressive}}} contract the detail
    // endpoint (getVideoByCategory) returns, so the FE can download
    // (hls/progressive) straight from the list without a per-row detail call.
    // resolveVideoSource is Redis-cached (4h YouTube / 24h AWS), so warm pages
    // are cheap; cold pages pay one upstream call per uncached video but run
    // concurrently. Failures are isolated per video — a single unresolvable
    // video yields request:null instead of failing the whole page.
    const envelopeByVideo = new Map<string, any>();
    await Promise.all(
      rawList.map(async (v: any) => {
        try {
          const env = await encryptVideoEnvelope(v);
          envelopeByVideo.set(String(v._id), env.request);
        } catch (err: any) {
          logger.warn("listVideosByCategory envelope resolve failed", {
            traceId,
            videoId: String(v._id),
            platform: v.platform,
            error: err?.message,
          });
          envelopeByVideo.set(String(v._id), null);
        }
      })
    );

    const list = rawList.map((v: any) => {
      // Drop the raw string `priceType` from the row and expose a boolean
      // `isPaid` instead (isPaid = priceType === "paid").
      const { priceType, ...shapedDoc } = shapeVideoForList(v);
      const shaped = shapedDoc;
      const isPaid = priceType === "paid";
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
        isPaid,
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
        // Encrypted playback envelope: { files: { token, hls, progressive } },
        // identical to the detail endpoint. null when the video's source
        // couldn't be resolved (upstream error / missing id).
        request: envelopeByVideo.get(String(v._id)) ?? null,
      };
    });

    logger.info("listVideosByCategory success", { traceId, categoryId: id, total, returned: list.length, scopeKind: scope?.kind ?? null });
    return res.status(200).json({
      success: true,
      data: { category, scope, list },
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
    let scope;
    try {
      // Resolve the owning container alongside the playback envelope so the FE
      // can echo `scope` straight into the progress heartbeat — no guessing.
      [envelope, scope] = await Promise.all([
        encryptVideoEnvelope(video),
        resolveVideoScope(video.videoCategoryId),
      ]);
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

    logger.info("getVideoByCategory success", { traceId, categoryId: id, videoId, platform: video.platform, scopeKind: scope?.kind ?? null });
    return res.status(200).json({
      success: true,
      data: {
        _id: String(video._id),
        title: video.title ?? "",
        topic: video.topic ?? "",
        platform: video.platform,
        priceType: video.priceType,
        scope,
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
    // Optional price filter. `?type=free` → only free materials, `?type=paid` →
    // only paid. Any other value is ignored (no filter). Maps to the Material
    // model's `isPaid` flag. Mirrors listVideosByCategory's `type`/priceType.
    const typeQ = String(req.query.type ?? "").toLowerCase();
    if (typeQ === "free") filter.isPaid = false;
    else if (typeQ === "paid") filter.isPaid = true;

    const [rawList, total] = await Promise.all([
      Material.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Material.countDocuments(filter),
    ]);
    // Surface isPaid/isPurchased and gate file/directLink for locked paid items.
    const ownedIds = await getPurchasedMaterialIds(req.user?.id, rawList as any);
    const list = rawList.map((m) => shapeMaterialForClient(m, ownedIds));

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
    const filter: any = { categoryId: id, status: ExamStatus.PUBLISHED };
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

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const childIds = (parent.childCategoryIds || []) as mongoose.Types.ObjectId[];
    const childFilter: any = { _id: { $in: childIds }, status: true };
    if (search) childFilter.title = { $regex: search, $options: "i" };
    const children = childIds.length
      ? await VideoCategory.find(childFilter)
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

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const childIds = (parent.childCategoryIds || []) as mongoose.Types.ObjectId[];
    const childFilter: any = { _id: { $in: childIds }, status: true };
    if (search) childFilter.title = { $regex: search, $options: "i" };
    const children = childIds.length
      ? await MaterialCategory.find(childFilter)
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

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const childIds = (parent.childCategoryIds || []) as mongoose.Types.ObjectId[];
    // ExamCategory's display field is `name` (not `title`), so search matches `name`.
    const childFilter: any = { _id: { $in: childIds }, status: true };
    if (search) childFilter.name = { $regex: search, $options: "i" };
    const children = childIds.length
      ? await ExamCategory.find(childFilter)
          .sort({ orderBy: 1 })
          .lean()
      : [];

    const list = await Promise.all(
      children.map(async (cat: any) => {
        // Roll the count up through nested child folders and count only
        // PUBLISHED exams, matching what the client can actually open.
        const ids = await collectCategoryTreeIds(ExamCategory, cat);
        const count = await Exam.countDocuments({
          categoryId: { $in: ids },
          status: ExamStatus.PUBLISHED,
        });
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

// GET /client/exam-countdown/:id/packages
// :id is an ExamCountdown _id (a single exam event), NOT a category. Returns the
// packages AND live courses tied to that exam, merged into one `list` where each
// row is tagged `type: "package"` or `type: "live-course"` so the FE can split
// the listing by type. Matching is by the exam's `examCountdownIds` membership
// (both Package and LiveCourse carry that array); package plans mirror the
// `/exam-countdown-categories/:id/packages` shape and live-course plans mirror
// `/client/live-courses`.
export const listProductsByExamCountdown = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listProductsByExamCountdown invoked", { traceId, path: req.originalUrl, examCountdownId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listProductsByExamCountdown invalid id", { traceId, examCountdownId: id });
      return res.status(400).json({ success: false, message: "Invalid exam countdown id." });
    }

    const examCountdown = await ExamCountdown.findById(id).lean();
    if (!examCountdown) {
      logger.warn("listProductsByExamCountdown not found", { traceId, examCountdownId: id });
      return res.status(404).json({ success: false, message: "Exam countdown not found." });
    }

    const { pageNum, limitNum, skip, search } = parsePaging(req);

    const packageFilter: any = { examCountdownIds: id, active: true };
    if (search) packageFilter.name = { $regex: search, $options: "i" };
    const liveFilter: any = { examCountdownIds: id, status: true };
    if (search) liveFilter.name = { $regex: search, $options: "i" };

    const [packages, liveCourses] = await Promise.all([
      Package.find(packageFilter)
        .populate("packageTypeId", "_id name")
        .populate("goalId", "_id title")
        .sort({ order: 1, createdAt: -1 })
        .lean(),
      LiveCourse.find(liveFilter)
        .populate("courseEducatorId", "name image")
        .populate("packageCategoryId", "title slug image")
        .sort({ ordered: 1, createdAt: -1 })
        .lean(),
    ]);

    const customerId = req.user?.id;
    const now = new Date();
    const packageIds = packages.map((p: any) => p._id);
    const liveCourseIds = liveCourses.map((c: any) => c._id);

    // Batch the pricing + subscriber + ownership queries across both product
    // types, then group per row below. Ownership/daysLeft reuse the canonical
    // helpers (purchasedPackageEndAtMap, getDaysLeftMapForLiveCourses) so the
    // isPurchased/daysLeft contract matches /client/packages and /client/live-courses.
    const [pkgPlans, pkgSubCounts, livePlans, liveSubCounts, ownedPkgMap, liveDaysLeftMap] = await Promise.all([
      packageIds.length
        ? PackageCourseEbookPrice.find({ packageId: { $in: packageIds }, status: true }).sort({ duration: 1 }).lean()
        : Promise.resolve([] as any[]),
      packageIds.length
        ? PackageCourseSubscription.aggregate([
            { $match: { packageId: { $in: packageIds }, status: true } },
            { $group: { _id: "$packageId", count: { $sum: 1 } } },
          ])
        : Promise.resolve([] as any[]),
      liveCourseIds.length
        ? LiveCoursePlan.find({ liveCourseId: { $in: liveCourseIds }, status: true }).sort({ price: 1 }).lean()
        : Promise.resolve([] as any[]),
      liveCourseIds.length
        ? LiveCourseSubscription.aggregate([
            { $match: { liveCourseId: { $in: liveCourseIds }, status: true, paymentStatus: "verified" } },
            { $group: { _id: "$liveCourseId", count: { $sum: 1 } } },
          ])
        : Promise.resolve([] as any[]),
      purchasedPackageEndAtMap(customerId, packageIds),
      getDaysLeftMapForLiveCourses(customerId, liveCourseIds),
    ]);

    const pkgPlansById: Record<string, any[]> = {};
    for (const pl of pkgPlans as any[]) (pkgPlansById[String(pl.packageId)] ||= []).push(pl);
    const pkgSubById = new Map<string, number>();
    for (const r of pkgSubCounts as any[]) pkgSubById.set(String(r._id), r.count);

    const livePlansById: Record<string, any[]> = {};
    for (const pl of livePlans as any[]) {
      const original =
        typeof pl.originalPrice === "number" && pl.originalPrice > pl.price ? pl.originalPrice : null;
      const discountPercent = original ? Math.round(((original - pl.price) / original) * 100) : 0;
      (livePlansById[String(pl.liveCourseId)] ||= []).push({ ...pl, originalPrice: original, discountPercent });
    }
    const liveSubById = new Map<string, number>();
    for (const r of liveSubCounts as any[]) liveSubById.set(String(r._id), r.count);

    const packageRows = packages.map((p: any) => {
      const pid = String(p._id);
      const plans = pkgPlansById[pid] || [];
      const isPurchased = ownedPkgMap.has(pid);
      return {
        ...p,
        type: "package" as const,
        plans: {
          withMaterial: plans.filter((pl) => pl.withMaterial),
          withoutMaterial: plans.filter((pl) => !pl.withMaterial),
        },
        subscriberCount: pkgSubById.get(pid) ?? 0,
        // Package.isPaid is on the doc (spread above) but surface it explicitly
        // so the row contract is uniform across both product types.
        isPaid: p.isPaid !== false,
        isPurchased,
        daysLeft: isPurchased ? computeDaysLeft(ownedPkgMap.get(pid) ?? null, now) : null,
      };
    });

    const liveRows = liveCourses.map((c: any) => {
      const cid = String(c._id);
      const isPurchased = liveDaysLeftMap.has(cid);
      return {
        ...c,
        type: "live-course" as const,
        plans: livePlansById[cid] || [],
        subscriberCount: liveSubById.get(cid) ?? 0,
        isPaid: c.isPaid !== false,
        isPurchased,
        // Map value is daysLeft (null = lifetime); absence = not owned → null.
        daysLeft: isPurchased ? liveDaysLeftMap.get(cid) ?? null : null,
      };
    });

    const merged = [...packageRows, ...liveRows].sort(
      (a, b) =>
        new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
    );

    const total = merged.length;
    const list = merged.slice(skip, skip + limitNum);

    logger.info("listProductsByExamCountdown success", { traceId, examCountdownId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { examCountdown, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listProductsByExamCountdown failed", { traceId, examCountdownId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Shared enrichment for the two books-ebooks listings (by ExamCountdown and by
// ExamCountdownCategory). Takes the raw Book/Ebook docs + the viewer, joins
// ebook pricing/ownership and book ownership, stamps a uniform
// isPaid/isPurchased/daysLeft contract on every row, tags each row with `type`,
// and returns the merged list sorted by createdAt desc (caller paginates).
//
// Per-type flag semantics:
//   ebook → isPaid from admin flag (price-derived fallback); isPurchased/daysLeft
//           from active EbookSubscription (subscription model, can expire).
//   book  → physical one-time purchase: isPaid is always true (no free-book
//           concept) and daysLeft is always null (no expiry); isPurchased from a
//           BookOrder in a fulfilled state (verified/shipped/delivered), mirroring
//           getBookDetail.
const shapeBooksAndEbooks = async (
  books: any[],
  ebooks: any[],
  customerId: string | undefined
) => {
  const now = new Date();
  const ebookIds = ebooks.map((e) => e._id);
  const bookIds = books.map((b) => b._id);

  const [ebookPlans, ebookSubs, ownedBookOrders] = await Promise.all([
    ebookIds.length
      ? EbookPrice.find({ ebookId: { $in: ebookIds }, status: true }).sort({ duration: 1 }).lean()
      : Promise.resolve([] as any[]),
    customerId && ebookIds.length
      ? EbookSubscription.find({
          customerId,
          ebookId: { $in: ebookIds },
          status: true,
          endAt: { $gt: now },
        })
          .select("ebookId endAt")
          .lean()
      : Promise.resolve([] as any[]),
    customerId && bookIds.length
      ? BookOrder.find({
          customerId,
          "items.bookId": { $in: bookIds },
          status: {
            $in: [BookOrderStatus.VERIFIED, BookOrderStatus.SHIPPED, BookOrderStatus.DELIVERED],
          },
        })
          .select("items.bookId")
          .lean()
      : Promise.resolve([] as any[]),
  ]);

  const plansByEbook: Record<string, any[]> = {};
  for (const p of ebookPlans as any[]) (plansByEbook[String(p.ebookId)] ||= []).push(p);
  const endAtByEbook = new Map<string, Date>();
  for (const s of ebookSubs as any[]) {
    const key = String(s.ebookId);
    const prev = endAtByEbook.get(key);
    if (!prev || s.endAt.getTime() > prev.getTime()) endAtByEbook.set(key, s.endAt);
  }
  const ownedBookIds = new Set<string>();
  for (const o of ownedBookOrders as any[]) {
    for (const it of o.items ?? []) if (it.bookId) ownedBookIds.add(String(it.bookId));
  }
  const daysBetween = (from: Date, to: Date) =>
    Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

  const ebooksWithPricing = ebooks.map((e: any) => {
    const ePlans = plansByEbook[String(e._id)] || [];
    const endAt = endAtByEbook.get(String(e._id)) || null;
    // Admin-controlled `isPaid` field is the source of truth (default true);
    // fall back to the price-derived rule only if it's absent.
    const isPaid =
      typeof e.isPaid === "boolean" ? e.isPaid : ePlans.some((p: any) => (p.price ?? 0) > 0);
    return {
      ...e,
      type: "ebook" as const,
      plans: ePlans,
      isPaid,
      isPurchased: !!endAt,
      subscriptionEndAt: endAt,
      daysLeft: endAt ? daysBetween(now, endAt) : null,
    };
  });

  const booksShaped = books.map((b: any) => ({
    ...b,
    type: "book" as const,
    isPaid: true,
    isPurchased: ownedBookIds.has(String(b._id)),
    daysLeft: null as number | null,
  }));

  return [...booksShaped, ...ebooksWithPricing].sort(
    (a, b) =>
      new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
  );
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
    // Match on the multi-select examCountdownCategoryIds array (membership), not
    // the legacy single examCountdownCategoryId. Mongo matches a scalar against
    // an array field by element membership, so `{ examCountdownCategoryIds: id }`
    // returns every book/ebook whose array contains this category.
    const filter: any = { examCountdownCategoryIds: id, status: true };
    if (search) filter.name = { $regex: search, $options: "i" };

    const [books, ebooks] = await Promise.all([
      Book.find(filter).lean(),
      Ebook.find(filter).lean(),
    ]);

    const merged = await shapeBooksAndEbooks(books, ebooks, req.user?.id);
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

// GET /client/exam-countdown/:id/books-ebooks
// :id is an ExamCountdown _id (a single exam event), NOT a category. Returns the
// books + ebooks linked to that exam via their `examCountdownIds` array, merged
// into one `list` where each row is tagged `type: "book"` or `type: "ebook"`.
// Shape mirrors listBooksAndEbooksByExamCountdownCategory (ebook rows get joined
// pricing + isPaid/isPurchased/daysLeft) so the FE can reuse the same cards.
export const listBooksAndEbooksByExamCountdown = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listBooksAndEbooksByExamCountdown invoked", { traceId, path: req.originalUrl, examCountdownId: id, userId: req.user?.id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listBooksAndEbooksByExamCountdown invalid id", { traceId, examCountdownId: id });
      return res.status(400).json({ success: false, message: "Invalid exam countdown id." });
    }

    const examCountdown = await ExamCountdown.findById(id).lean();
    if (!examCountdown) {
      logger.warn("listBooksAndEbooksByExamCountdown not found", { traceId, examCountdownId: id });
      return res.status(404).json({ success: false, message: "Exam countdown not found." });
    }

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const filter: any = { examCountdownIds: id, status: true };
    if (search) filter.name = { $regex: search, $options: "i" };

    const [books, ebooks] = await Promise.all([
      Book.find(filter).lean(),
      Ebook.find(filter).lean(),
    ]);

    const merged = await shapeBooksAndEbooks(books, ebooks, req.user?.id);
    const total = merged.length;
    const list = merged.slice(skip, skip + limitNum);

    logger.info("listBooksAndEbooksByExamCountdown success", { traceId, examCountdownId: id, total, returned: list.length });
    return res.status(200).json({
      success: true,
      data: { examCountdown, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listBooksAndEbooksByExamCountdown failed", { traceId, examCountdownId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Package Categories ──────────────────────────────────────────────────────
import { PackageCategory } from "../../models/course/PackageCategory.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";

export const listPackageCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveOnly = String(req.query.live ?? "").toLowerCase() === "true";
  const { pageNum, limitNum, skip, search } = parsePaging(req);
  logger.info("listPackageCategories invoked", { traceId, path: req.originalUrl, liveOnly });

  try {
    const filter: any = { status: true };
    if (search) filter.title = { $regex: search, $options: "i" };

    // Active recorded-package count per category, batched into a single
    // aggregation keyed by packageCategoryId, then looked up per row. Mirrors
    // the membership used by listPackagesByCategory (active packages).
    const packageCountFor = async (catIds: mongoose.Types.ObjectId[]) => {
      if (!catIds.length) return new Map<string, number>();
      const rows = await Package.aggregate([
        { $match: { active: true, packageCategoryId: { $in: catIds } } },
        { $group: { _id: "$packageCategoryId", count: { $sum: 1 } } },
      ]);
      return new Map(rows.map((r: any) => [String(r._id), r.count]));
    };

    if (!liveOnly) {
      const [rawList, total] = await Promise.all([
        PackageCategory.find(filter).sort({ order: 1 }).skip(skip).limit(limitNum).lean(),
        PackageCategory.countDocuments(filter),
      ]);
      const countMap = await packageCountFor(rawList.map((c: any) => c._id));
      const list = rawList.map((c: any) => ({ ...c, packageCount: countMap.get(String(c._id)) ?? 0 }));
      logger.info("listPackageCategories success", { traceId, total, returned: list.length, liveOnly });
      return res.status(200).json({
        success: true,
        data: list,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    }

    // ?live=true → keep only categories that have ≥1 active LiveCourse. The
    // live-filter is computed across the full matching set first, then paged,
    // so totalPages reflects the filtered count rather than the raw category
    // count.
    const categories = await PackageCategory.find(filter).sort({ order: 1 }).lean();
    const categoryIds = categories.map((c: any) => c._id);
    const liveCategoryIds = await LiveCourse.distinct("packageCategoryId", {
      status: true,
      packageCategoryId: { $in: categoryIds },
    });
    const liveSet = new Set(liveCategoryIds.map((x: any) => String(x)));
    const filtered = categories.filter((c: any) => liveSet.has(String(c._id)));

    const total = filtered.length;
    const paged = filtered.slice(skip, skip + limitNum);
    const countMap = await packageCountFor(paged.map((c: any) => c._id));
    const list = paged.map((c: any) => ({ ...c, packageCount: countMap.get(String(c._id)) ?? 0 }));

    logger.info("listPackageCategories success", { traceId, total, returned: list.length, liveOnly });
    return res.status(200).json({
      success: true,
      data: list,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
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
          "_id name description image shareableLink order isPaid isSmartCourse isPlannerCourse withMaterialText withoutMaterialText packageTypeId goalId educatorId"
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

