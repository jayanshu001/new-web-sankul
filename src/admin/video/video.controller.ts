import { Request, Response } from "express";
import {
  createVideoSchema,
  updateVideoSchema,
  listQuerySchema,
  reorderSchema,
} from "./video.validation";
import * as videoSql from "../../modules/admin-video/admin-video.service";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

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

    const { items, total } = await videoSql.listVideos({ search, status, type, platform, videoCategoryId, page, per_page, sort_by, sort_dir });
    return res.status(200).json({ success: true, data: { items, pagination: { page, per_page, total } } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /pre-requisites
export const getVideoPreRequisites = async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, data: await videoSql.getPreRequisites() });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id
export const getVideo = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = videoSql.parseVideoId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video ID" });
    const data = await videoSql.getVideo(numId);
    if (!data) return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, data });
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

    const r = await videoSql.createVideo(d as any);
    if (!r.ok) return res.status(404).json({ success: false, message: "Video category not found" });
    return res.status(201).json({ success: true, message: "Video created successfully", data: r.data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /:id
export const updateVideo = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = updateVideoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const d = parsed.data;

    const numId = videoSql.parseVideoId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video ID" });
    const r = await videoSql.updateVideo(numId, d);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Video not found" });
    if (r === "category") return res.status(404).json({ success: false, message: "Video category not found" });
    return res.status(200).json({ success: true, message: "Video updated successfully", data: r });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /:id
export const deleteVideo = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = videoSql.parseVideoId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video ID" });
    if (!(await videoSql.deleteVideo(numId))) return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, message: "Video deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /:id/status
export const toggleVideoStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = videoSql.parseVideoId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video ID" });
    const s = await videoSql.toggleStatus(numId);
    if (s === null) return res.status(404).json({ success: false, message: "Video not found" });
    return res.status(200).json({ success: true, data: { status: s } });
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
    await videoSql.reorderVideos(parsed.data.orders);
    return res.status(200).json({ success: true, message: "Videos reordered successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
