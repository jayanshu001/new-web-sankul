import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCourseMaterial } from "../../models/course/PackageCourseMaterial.model";
import { createMaterialSchema, updateMaterialSchema } from "./master.validation";

export const getMaterials = async (req: Request, res: Response) => {
  try {
    const materials = await PackageCourseMaterial.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: materials });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createMaterial = async (req: Request, res: Response) => {
  try {
    const validatedData = createMaterialSchema.parse(req.body);
    const material = new PackageCourseMaterial(validatedData);
    await material.save();
    res.status(201).json({ success: true, data: material });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Material ID" });
    }
    const validatedData = updateMaterialSchema.parse(req.body);
    const material = await PackageCourseMaterial.findByIdAndUpdate(id, validatedData, { new: true });
    if (!material) return res.status(404).json({ success: false, message: "Material not found" });
    res.status(200).json({ success: true, data: material });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Material ID" });
    }
    const material = await PackageCourseMaterial.findByIdAndDelete(id);
    if (!material) return res.status(404).json({ success: false, message: "Material not found" });
    res.status(200).json({ success: true, message: "Material deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
