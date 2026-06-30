import { Request, Response } from "express";
import {
  parseAcvId,
  categoryExists as acvCategoryExists,
  listVideos as acvListVideos,
  getVideoById as acvGetVideoById,
  createVideo as acvCreateVideo,
  updateVideo as acvUpdateVideo,
  deleteVideo as acvDeleteVideo,
  reorderVideos as acvReorderVideos,
} from "../../modules/admin-course-video/admin-course-video.service";

// Body validation for the SQL branch (numeric category id; mirrors createVideoSchema fields).
const acvParseBody = (body: any, partial: boolean) => {
  const out: any = {};
  const has = (k: string) => body && body[k] !== undefined && body[k] !== null;

  if (!partial || has("videoCategoryId")) {
    const catId = parseAcvId(String(body?.videoCategoryId ?? ""));
    if (catId === null) return { error: "Invalid videoCategoryId" as const };
    out.videoCategoryId = catId;
  }
  if (!partial || has("title")) {
    if (!has("title") || String(body.title).length < 1) return { error: "Title is required" as const };
    out.title = String(body.title);
  }
  if (!partial || has("slug")) {
    if (!has("slug") || String(body.slug).length < 1) return { error: "Slug is required" as const };
    out.slug = String(body.slug);
  }
  if (!partial || has("platform")) {
    if (!["youtube", "aws", "vimeo"].includes(body?.platform)) return { error: "Invalid platform" as const };
    out.platform = body.platform;
  }
  if (has("topic")) out.topic = String(body.topic);
  else if (!partial) out.topic = "";
  if (has("priceType")) {
    if (!["free", "paid"].includes(body.priceType)) return { error: "Invalid priceType" as const };
    out.priceType = body.priceType;
  } else if (!partial) out.priceType = "paid";
  if (has("order")) out.order = Number(body.order);
  else if (!partial) out.order = 0;
  if (has("status")) out.status = Boolean(body.status);
  else if (!partial) out.status = true;
  if (has("youtube_id")) out.youtube_id = String(body.youtube_id);
  if (has("aws_id")) out.aws_id = String(body.aws_id);
  if (has("vimeo_id")) out.vimeo_id = String(body.vimeo_id);

  return { data: out };
};

export const getVideos = async (req: Request, res: Response) => {
  try {
    const {
      videoCategoryId,
      status,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    let catId: number | undefined;
    if (videoCategoryId) {
      const parsed = parseAcvId(videoCategoryId);
      if (parsed === null) {
        return res.status(400).json({ success: false, message: "Invalid videoCategoryId" });
      }
      catId = parsed;
    }
    const { data, total } = await acvListVideos({
      videoCategoryId: catId,
      status: status === "active" ? true : status === "inactive" ? false : undefined,
      skip,
      take: limitNum,
    });
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVideoById = async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string;

    const numId = parseAcvId(videoId);
    if (numId === null) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const found = await acvGetVideoById(numId);
    if (!found) return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, data: found });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createVideo = async (req: Request, res: Response) => {
  try {
    const parsed = acvParseBody(req.body, false);
    if ("error" in parsed) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    if (!(await acvCategoryExists(parsed.data.videoCategoryId))) {
      return res.status(404).json({ success: false, message: "Video category not found" });
    }
    const created = await acvCreateVideo(parsed.data);
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVideo = async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string;

    const numId = parseAcvId(videoId);
    if (numId === null) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const parsed = acvParseBody(req.body, true);
    if ("error" in parsed) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    if (parsed.data.videoCategoryId !== undefined && !(await acvCategoryExists(parsed.data.videoCategoryId))) {
      return res.status(404).json({ success: false, message: "Video category not found" });
    }
    const result = await acvUpdateVideo(numId, parsed.data);
    if (result === "not_found") return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVideo = async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string;

    const numId = parseAcvId(videoId);
    if (numId === null) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const ok = await acvDeleteVideo(numId);
    if (!ok) return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, message: "Video deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderVideos = async (req: Request, res: Response) => {
  try {
    const { orders } = req.body as { orders: { id: string; order: number }[] };

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, message: "orders array is required" });
    }

    for (const item of orders) {
      if (parseAcvId(item.id) === null) {
        return res.status(400).json({ success: false, message: `Invalid video ID: ${item.id}` });
      }
    }
    await acvReorderVideos(orders);
    return res.status(200).json({ success: true, message: "Videos reordered successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
