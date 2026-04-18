import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { createVideoCategorySchema, updateVideoCategorySchema } from "./master.validation";

export const getVideoCategories = async (req: Request, res: Response) => {
  try {
    const categories = await VideoCategory.find().sort({ order_by: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createVideoCategory = async (req: Request, res: Response) => {
  try {
    const validatedData = createVideoCategorySchema.parse(req.body);
    const category = new VideoCategory(validatedData);
    await category.save();
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const validatedData = updateVideoCategorySchema.parse(req.body);
    const category = await VideoCategory.findByIdAndUpdate(id, validatedData, { new: true });
    if (!category) return res.status(404).json({ success: false, message: "Video Category not found" });
    res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const category = await VideoCategory.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ success: false, message: "Video Category not found" });
    const rel = await VideoCategoryRelation.deleteMany({
      $or: [{ parent: id }, { child: id }],
    });
    res.status(200).json({
      success: true,
      message: "Video Category deleted successfully",
      data: { deletedRelations: rel.deletedCount ?? 0 },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
