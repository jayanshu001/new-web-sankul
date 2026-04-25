import { Request, Response } from "express";
import mongoose from "mongoose";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { createEducatorSchema, updateEducatorSchema } from "./master.validation";

export const getEducators = async (req: Request, res: Response) => {
  try {
    const educators = await CourseEducator.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: educators });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createEducator = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = createEducatorSchema.parse(req.body);
    const educator = new CourseEducator(validatedData);
    await educator.save();
    res.status(201).json({ success: true, data: educator });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updateEducatorSchema.parse(req.body);
    const educator = await CourseEducator.findByIdAndUpdate(id, validatedData, { new: true });
    if (!educator) return res.status(404).json({ success: false, message: "Educator not found" });
    res.status(200).json({ success: true, data: educator });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }
    const educator = await CourseEducator.findByIdAndDelete(id);
    if (!educator) return res.status(404).json({ success: false, message: "Educator not found" });
    res.status(200).json({ success: true, message: "Educator deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
