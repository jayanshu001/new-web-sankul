import { Request, Response } from "express";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { createSubjectCategorySchema, updateSubjectCategorySchema } from "./master.validation";

export const getSubjectCategories = async (req: Request, res: Response) => {
  try {
    const categories = await CourseSubjectCategory.find().sort({ order: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createSubjectCategory = async (req: Request, res: Response) => {
  try {
    const validatedData = createSubjectCategorySchema.parse(req.body);
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
    const validatedData = updateSubjectCategorySchema.parse(req.body);
    const category = await CourseSubjectCategory.findByIdAndUpdate(req.params.id, validatedData, { new: true });
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteSubjectCategory = async (req: Request, res: Response) => {
  try {
    const category = await CourseSubjectCategory.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.status(200).json({ success: true, message: "Category deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
