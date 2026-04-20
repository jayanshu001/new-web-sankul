import { Request, Response } from "express";
import mongoose from "mongoose";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { createVideoSchema, updateVideoSchema } from "../master/master.validation";

export const getVideos = async (req: Request, res: Response) => {
  try {
    const {
      videoCategoryId,
      status,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filters: any = {};
    if (videoCategoryId) {
      if (!mongoose.Types.ObjectId.isValid(videoCategoryId)) {
        return res.status(400).json({ success: false, message: "Invalid videoCategoryId" });
      }
      filters.videoCategoryId = videoCategoryId;
    }
    if (status === "true" || status === "false") {
      filters.status = status === "true";
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Video.find(filters)
        .populate("videoCategoryId", "_id title slug")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Video.countDocuments(filters),
    ]);

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
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }

    const video = await Video.findById(videoId).populate("videoCategoryId", "_id title slug");
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });

    return res.status(200).json({ success: true, data: video });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createVideo = async (req: Request, res: Response) => {
  try {
    const validatedData = createVideoSchema.parse(req.body);

    if (!mongoose.Types.ObjectId.isValid(validatedData.videoCategoryId)) {
      return res.status(400).json({ success: false, message: "Invalid videoCategoryId" });
    }

    const categoryExists = await VideoCategory.exists({ _id: validatedData.videoCategoryId });
    if (!categoryExists) {
      return res.status(404).json({ success: false, message: "Video category not found" });
    }

    const video = new Video(validatedData);
    await video.save();
    return res.status(201).json({ success: true, data: video });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVideo = async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }

    const validatedData = updateVideoSchema.parse(req.body);

    if (validatedData.videoCategoryId) {
      const categoryExists = await VideoCategory.exists({ _id: validatedData.videoCategoryId });
      if (!categoryExists) {
        return res.status(404).json({ success: false, message: "Video category not found" });
      }
    }

    const video = await Video.findByIdAndUpdate(videoId, validatedData, { new: true });
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });

    return res.status(200).json({ success: true, data: video });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVideo = async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ success: false, message: "Invalid Video ID" });
    }

    const video = await Video.findByIdAndDelete(videoId);
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });

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
      if (!mongoose.Types.ObjectId.isValid(item.id)) {
        return res.status(400).json({ success: false, message: `Invalid video ID: ${item.id}` });
      }
    }

    await Promise.all(
      orders.map(({ id, order }) => Video.findByIdAndUpdate(id, { order }))
    );

    return res.status(200).json({ success: true, message: "Videos reordered successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
