import { Request, Response } from "express";
import mongoose from "mongoose";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { createSubjectCategorySchema, updateSubjectCategorySchema } from "./master.validation";
import * as master from "../../modules/admin-master/admin-master.service";

export const getSubjectCategories = async (req: Request, res: Response) => {
  try {
    if (master.isAdminMasterMysql()) {
      const { search, sortBy, sortOrder, page, limit } = req.query as Record<string, string>;
      // Pagination is opt-in: page/limit present → paginate + return a `pagination`
      // block; otherwise the full list (back-compat for dropdown/form callers).
      const paginate = page !== undefined || limit !== undefined;
      const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
      const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
      const { data, total } = await master.subjList({
        search,
        sortBy,
        sortDir: sortOrder === "desc" ? "desc" : "asc",
        ...(paginate ? { skip: (pageNum - 1) * limitNum, take: limitNum } : {}),
      });
      return res.status(200).json(
        paginate
          ? { success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } }
          : { success: true, data }
      );
    }
    const categories = await CourseSubjectCategory.find().sort({ order: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createSubjectCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = createSubjectCategorySchema.parse(req.body);
    if (master.isAdminMasterMysql()) return res.status(201).json({ success: true, data: await master.subjCreate(validatedData) });
    const category = new CourseSubjectCategory(validatedData);
    await category.save();
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSubjectCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updateSubjectCategorySchema.parse(req.body);
    if (master.isAdminMasterMysql()) {
      const numId = master.parseMasterId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid Subject Category ID" });
      const data = await master.subjUpdate(numId, validatedData);
      if (!data) return res.status(404).json({ success: false, message: "Category not found" });
      return res.status(200).json({ success: true, data });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Subject Category ID" });
    }
    const category = await CourseSubjectCategory.findByIdAndUpdate(id, validatedData, { new: true });
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteSubjectCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (master.isAdminMasterMysql()) {
      const numId = master.parseMasterId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid Subject Category ID" });
      if (!(await master.subjDelete(numId))) return res.status(404).json({ success: false, message: "Category not found" });
      return res.status(200).json({ success: true, message: "Category deleted successfully" });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Subject Category ID" });
    }
    const category = await CourseSubjectCategory.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.status(200).json({ success: true, message: "Category deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
