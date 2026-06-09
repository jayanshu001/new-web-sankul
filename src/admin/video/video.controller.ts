import { Request, Response } from "express";
import mongoose from "mongoose";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import {
  createVideoSchema,
  updateVideoSchema,
  listQuerySchema,
  reorderSchema,
  sortFieldMap,
} from "./video.validation";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

// Returns a slug that isn't already used by another video, appending -2, -3, …
// to the requested base until it's free. Never throws — create/update should
// silently uniquify rather than 409 on a slug clash. `excludeId` skips the row
// being updated so re-saving an unchanged slug doesn't collide with itself.
// Mirrors the uniqueSlug helper in videoCategory.controller.
const uniqueVideoSlug = async (base: string, excludeId?: string): Promise<string> => {
  const root = base || "video";
  let candidate = root;
  let n = 1;
  const taken = async (slug: string) =>
    Video.exists(excludeId ? { slug, _id: { $ne: excludeId } } : { slug });
  while (await taken(candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
};

const toItem = (v: any) => ({
  id: v._id,
  name: v.title,
  slug: v.slug,
  order: v.order,
  topic: v.topic,
  type: v.priceType,
  status: v.status,
  video_category: v.videoCategoryId
    ? typeof v.videoCategoryId === "object"
      ? { id: v.videoCategoryId._id, name: v.videoCategoryId.title, slug: v.videoCategoryId.slug }
      : v.videoCategoryId
    : null,
  platform: v.platform,
  youtube: v.platform === "youtube",
  youtubeId: v.youtube_id,
  vimeo: v.platform === "vimeo",
  vimeoId: v.vimeo_id,
  aws: v.platform === "aws",
  awsId: v.aws_id,
  created_at: v.createdAt,
  updated_at: v.updatedAt,
});

function pickEnabledPlatform(d: {
  youtube?: boolean;
  vimeo?: boolean;
  aws?: boolean;
}): "youtube" | "vimeo" | "aws" | null {
  if (d.youtube) return "youtube";
  if (d.vimeo) return "vimeo";
  if (d.aws) return "aws";
  return null;
}

// GET /
export const listVideos = async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { search, status, type, platform, videoCategoryId, page, per_page, sort_by, sort_dir } =
      parsed.data;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
        { topic: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filter.status = status === "true";
    if (type) filter.priceType = type;
    if (platform) filter.platform = platform;
    if (videoCategoryId) filter.videoCategoryId = videoCategoryId;

    const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
    const skip = (page - 1) * per_page;

    const [items, total] = await Promise.all([
      Video.find(filter)
        .populate("videoCategoryId", "_id title slug")
        .sort(sort)
        .skip(skip)
        .limit(per_page)
        .lean(),
      Video.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: { items: items.map(toItem), pagination: { page, per_page, total } },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /pre-requisites
export const getVideoPreRequisites = async (_req: Request, res: Response) => {
  try {
    const categories = await VideoCategory.find({ status: true })
      .select("_id title slug childCategoryIds")
      .sort({ order_by: 1, title: 1 })
      .lean();
    return res.status(200).json({
      success: true,
      data: {
        // has_children flags parent folders so the FE can exclude them from the
        // video-category dropdown (a video attaches to a leaf only), without a
        // second call to the full category list. Mirrors the catalog feed's
        // `havingChildDirectory` (both derive from childCategoryIds).
        categories: categories.map((c: any) => ({
          id: c._id,
          name: c.title,
          slug: c.slug,
          has_children: (c.childCategoryIds?.length ?? 0) > 0,
        })),
        types: [
          { value: "free", label: "Free" },
          { value: "paid", label: "Paid" },
        ],
        platforms: ["youtube", "vimeo", "aws"],
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id
export const getVideo = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const video = await Video.findById(id)
      .populate("videoCategoryId", "_id title slug")
      .lean();
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, data: toItem(video) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /
export const createVideo = async (req: Request, res: Response) => {
  try {
    const parsed = createVideoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const d = parsed.data;

    const catExists = await VideoCategory.exists({ _id: d.videoCategoryId });
    if (!catExists) {
      return res.status(404).json({ success: false, message: "Video category not found" });
    }

    // Auto-uniquify instead of rejecting: a clashing slug gets -2/-3/… appended
    // so video creation never fails on a duplicate slug.
    const slug = await uniqueVideoSlug(d.slug);

    const platform = pickEnabledPlatform(d)!;
    const created = await Video.create({
      videoCategoryId: d.videoCategoryId,
      title: d.name,
      slug,
      topic: d.topic,
      order: d.order,
      priceType: d.type,
      platform,
      youtube_id: platform === "youtube" ? d.youtubeId ?? undefined : undefined,
      // vimeo_id: platform === "vimeo" ? d.vimeoId ?? undefined : undefined,
      aws_id: platform === "aws" ? d.awsId ?? undefined : undefined,
      status: d.status,
    });

    const populated = await Video.findById(created._id)
      .populate("videoCategoryId", "_id title slug")
      .lean();

    return res
      .status(201)
      .json({ success: true, message: "Video created successfully", data: toItem(populated) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /:id
export const updateVideo = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const parsed = updateVideoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const d = parsed.data;

    const video = await Video.findById(id);
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });

    if (d.videoCategoryId && d.videoCategoryId !== String(video.videoCategoryId)) {
      const ok = await VideoCategory.exists({ _id: d.videoCategoryId });
      if (!ok) {
        return res.status(404).json({ success: false, message: "Video category not found" });
      }
      video.videoCategoryId = d.videoCategoryId as any;
    }

    if (d.slug && d.slug !== video.slug) {
      // Auto-uniquify rather than 409 on a clash (excludes this row's own id).
      video.slug = await uniqueVideoSlug(d.slug, id);
    }

    if (d.name !== undefined) video.title = d.name;
    if (d.topic !== undefined) video.topic = d.topic;
    if (d.order !== undefined) video.order = d.order;
    if (d.type !== undefined) video.priceType = d.type;
    if (d.status !== undefined) video.status = d.status;

    const platformTouched =
      d.youtube !== undefined || /* d.vimeo !== undefined || */ d.aws !== undefined;
    if (platformTouched) {
      const platform = pickEnabledPlatform(d);
      if (platform) {
        video.platform = platform;
        video.youtube_id = platform === "youtube" ? d.youtubeId ?? undefined : undefined;
        // video.vimeo_id = platform === "vimeo" ? d.vimeoId ?? undefined : undefined;
        video.aws_id = platform === "aws" ? d.awsId ?? undefined : undefined;
      }
    } else {
      // Allow updating just the active platform's id without flipping toggles
      if (video.platform === "youtube" && d.youtubeId !== undefined)
        video.youtube_id = d.youtubeId ?? undefined;
      // if (video.platform === "vimeo" && d.vimeoId !== undefined)
      //   video.vimeo_id = d.vimeoId ?? undefined;
      if (video.platform === "aws" && d.awsId !== undefined)
        video.aws_id = d.awsId ?? undefined;
    }

    await video.save();

    const populated = await Video.findById(video._id)
      .populate("videoCategoryId", "_id title slug")
      .lean();

    return res
      .status(200)
      .json({ success: true, message: "Video updated successfully", data: toItem(populated) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /:id
export const deleteVideo = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const video = await Video.findByIdAndDelete(id);
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });
    return res
      .status(200)
      .json({ success: true, message: "Video deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /:id/status
export const toggleVideoStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }
    const video = await Video.findById(id).select("status");
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });
    video.status = !video.status;
    await video.save();
    return res.status(200).json({ success: true, data: { status: video.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /reorder
export const reorderVideos = async (req: Request, res: Response) => {
  try {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    await Promise.all(
      parsed.data.orders.map(({ id, order }) => Video.findByIdAndUpdate(id, { order }))
    );
    return res
      .status(200)
      .json({ success: true, message: "Videos reordered successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
