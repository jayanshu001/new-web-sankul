import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { createVideoCategorySchema, updateVideoCategorySchema } from "./master.validation";

export const getVideoCategories = async (req: Request, res: Response) => {
  try {
    // Populate childCategoryIds so each row can carry a `child_categories`
    // array (mirroring the admin /video-categories list) plus a `hasChildren`
    // boolean. This lets clients (e.g. the Course / Live Course modal, which
    // load via this endpoint) tell a parent category from a child without a
    // separate admin call — the non-admin VideoCategory shape previously had no
    // parent/child info at all. All pre-existing fields are preserved, so this
    // is purely additive and backward-compatible.
    const categories = await VideoCategory.find()
      .populate("childCategoryIds", "_id title slug status order_by")
      .sort({ order_by: 1 })
      .lean();

    const data = categories.map((c: any) => {
      const children = Array.isArray(c.childCategoryIds) ? c.childCategoryIds : [];
      return {
        ...c,
        // Populated child docs (or bare ids if a ref no longer resolves).
        child_categories: children,
        // A parent category is one that has at least one child.
        hasChildren: children.length > 0,
      };
    });

    res.status(200).json({ success: true, data });
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
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order_by === "string") req.body.order_by = Number(req.body.order_by);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
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
