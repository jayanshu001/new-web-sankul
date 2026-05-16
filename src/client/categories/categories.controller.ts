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
import { Innertube, Log } from "youtubei.js";
import { signYoutubeStream } from "./yt-proxy.controller";

Log.setLevel(Log.Level.ERROR);
import { randomBytes } from "crypto";

function proxyUrl(req: Request, youtubeId: string, itag: number): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`;
  return `${base}/api/v1/client/yt-proxy?t=${signYoutubeStream(youtubeId, itag)}`;
}

function uniqId(): string {
  return randomBytes(8).toString("hex");
}

let cachedInnertube: Promise<InstanceType<typeof Innertube>> | undefined;
function getInnertube() {
  if (!cachedInnertube) cachedInnertube = Innertube.create();
  return cachedInnertube;
}

function encryptFlat(v: any) {
  const token = generateToken(16);
  const key = generateKey(token);
  const vector = generateVector(token);
  const sourceId =
    v.platform === "youtube" ? v.youtube_id
    : v.platform === "aws" ? v.aws_id
    : v.vimeo_id;
  const videoURL = sourceId ? encrypt(String(sourceId), key, vector) : "";
  const { youtube_id, aws_id, vimeo_id, ...rest } = v;
  return { ...rest, token, videoURL };
}

function normalizeFormat(f: any) {
  const mime: string = f.mime_type ?? "";
  const isAudio = mime.startsWith("audio/");
  const isVideo = mime.startsWith("video/");
  const hasAudioInMux = isVideo && /,\s*mp4a|,\s*opus|,\s*vorbis/i.test(mime);
  return {
    url: f.url as string | undefined,
    itag: f.itag,
    mimeType: mime,
    bitrate: f.bitrate,
    hasAudio: isAudio || hasAudioInMux,
    hasVideo: isVideo,
    height: f.height,
    width: f.width,
    fps: f.fps,
    contentLength: f.content_length,
    audioBitrate: f.audio_quality === "AUDIO_QUALITY_HIGH" ? 192 : f.audio_quality === "AUDIO_QUALITY_MEDIUM" ? 128 : undefined,
    audioCodec: isAudio ? mime.match(/codecs="([^"]+)"/)?.[1] : undefined,
    videoCodec: isVideo ? mime.match(/codecs="([^"]+)"/)?.[1]?.split(",")[0]?.trim() : undefined,
    container: mime.split(";")[0]?.split("/")[1],
    approxDurationMs: f.approx_duration_ms,
    qualityLabel: f.quality_label ?? null,
  };
}

async function buildYoutubeItem(req: Request, v: any) {
  const yt = await getInnertube();
  const clientsToTry = ["IOS", "ANDROID", "WEB_EMBEDDED", "TV", "WEB"] as const;

  let normalized: ReturnType<typeof normalizeFormat>[] = [];
  for (const client of clientsToTry) {
    const info = await yt.getInfo(String(v.youtube_id), client as any);
    const sd: any = (info as any).streaming_data;
    if (!sd) continue;
    const raw = [...(sd.formats ?? []), ...(sd.adaptive_formats ?? [])];
    if (raw.length > 0) {
      normalized = raw.map(normalizeFormat);
      break;
    }
  }

  if (normalized.length === 0) throw new Error("No formats from YouTube");

  const videoStreams = normalized
    .filter((f) => f.hasVideo)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const audioStreams = normalized
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

  const ordered = [...videoStreams, ...audioStreams];
  const defaultStream = videoStreams[0] ?? audioStreams[0];

  const token = generateToken(16);
  const key = generateKey(token);
  const vector = generateVector(token);

  const youtubeId = String(v.youtube_id);

  const progressive = ordered.map((f) => {
    const label = f.qualityLabel ?? (f.hasAudio && !f.hasVideo ? "audio" : undefined);
    return {
      ...f,
      id: uniqId(),
      quality: label,
      qualityLabel: label,
      url: encrypt(proxyUrl(req, youtubeId, Number(f.itag)), key, vector),
    };
  });

  const hlsUrl = encrypt(proxyUrl(req, youtubeId, Number(defaultStream.itag)), key, vector);
  const { youtube_id, aws_id, vimeo_id, ...rest } = v;

  return {
    ...rest,
    request: {
      files: {
        hls: {
          default_cdn: "akfire_interconnect_quic",
          cdns: { akfire_interconnect_quic: { url: hlsUrl } },
        },
        progressive,
        token,
      },
    },
  };
}

async function shapeVideoForList(req: Request, v: any) {
  if (v.platform === "youtube") {
    if (!v.youtube_id) {
      console.warn("[video-list] youtube item missing youtube_id", { _id: v._id });
      return encryptFlat(v);
    }
    try {
      return await buildYoutubeItem(req, v);
    } catch (err: any) {
      console.error("[video-list] ytdl.getInfo failed", {
        _id: v._id,
        youtube_id: v.youtube_id,
        error: err?.message,
      });
      return encryptFlat(v);
    }
  }
  return encryptFlat(v);
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

    const list = await Promise.all(rawList.map((v) => shapeVideoForList(req, v)));

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

// ─── Package Categories ──────────────────────────────────────────────────────
import { PackageCategory } from "../../models/course/PackageCategory.model";

export const listPackageCategories = async (req: Request, res: Response) => {
  try {
    const { packageId } = req.query as { packageId?: string };
    const filter: any = { status: true };
    if (packageId) {
      if (!mongoose.Types.ObjectId.isValid(packageId)) {
        return res.status(400).json({ success: false, message: "Invalid packageId" });
      }
      filter.packageId = new mongoose.Types.ObjectId(packageId);
    }
    const categories = await PackageCategory.find(filter)
      .populate("packageId", "_id name image")
      .sort({ order: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listCategoriesByPackage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid package id" });
    }
    const categories = await PackageCategory.find({ status: true, packageId: id }).sort({ order: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
