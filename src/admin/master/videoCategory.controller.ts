import { Request, Response } from "express";
import { createVideoCategorySchema, updateVideoCategorySchema } from "./master.validation";
import * as master from "../../modules/admin-master/admin-master.service";

export const getVideoCategories = async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const limitRaw = (req.query.limit ?? req.query.per_page) as string | undefined;
    const limit = limitRaw !== undefined ? Math.min(Math.max(parseInt(limitRaw) || 0, 0), 500) : undefined;
    return res.status(200).json({ success: true, data: await master.vcList({ search, limit }) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVideoCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = master.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const data = await master.vcGet(numId);
    if (!data) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createVideoCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order_by === "string") req.body.order_by = Number(req.body.order_by);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = createVideoCategorySchema.parse(req.body);
    return res.status(201).json({ success: true, data: await master.vcCreate(validatedData) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order_by === "string") req.body.order_by = Number(req.body.order_by);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updateVideoCategorySchema.parse(req.body);
    const numId = master.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const data = await master.vcUpdate(numId, validatedData);
    if (!data) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = master.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const result = await master.vcDelete(numId);
    if (!result.ok) return res.status(404).json({ success: false, message: "Video Category not found" });
    // Relation edges (ws_video_category_relation) are cleaned alongside the row.
    return res.status(200).json({ success: true, message: "Video Category deleted successfully", data: { deletedRelations: result.deletedRelations } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
