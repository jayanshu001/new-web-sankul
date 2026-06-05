// src/admin/pc-material/pc-material.controller.ts
//
// Package Course Material — a single-field ({ title }) master managed from the
// admin "Package Course Material Page". JSON-only (no multipart), thin handlers:
// validate -> mutate -> respond. Errors flow through the global errorHandler via
// asyncHandler. Backed by the existing PackageCourseMaterial model.

import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { PackageCourseMaterial } from "../../models/course/PackageCourseMaterial.model";
import { HttpError } from "../../middlewares/errorHandler";
import {
  createPcMaterialSchema,
  updatePcMaterialSchema,
} from "./pc-material.validation";

const assertObjectId = (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, "Invalid material id.");
  }
};

export const listPcMaterials = asyncHandler(async (_req: Request, res: Response) => {
  const data = await PackageCourseMaterial.find().sort({ createdAt: -1 }).lean();
  return res.status(200).json({ success: true, data });
});

export const getPcMaterialById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  assertObjectId(id);
  const data = await PackageCourseMaterial.findById(id).lean();
  if (!data) throw new HttpError(404, "Material not found.");
  return res.status(200).json({ success: true, data });
});

export const createPcMaterial = asyncHandler(async (req: Request, res: Response) => {
  const validated = createPcMaterialSchema.parse(req.body);
  const material = await PackageCourseMaterial.create(validated);
  return res.status(201).json({ success: true, data: material.toObject() });
});

export const updatePcMaterial = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  assertObjectId(id);
  const validated = updatePcMaterialSchema.parse(req.body);
  const material = await PackageCourseMaterial.findByIdAndUpdate(
    id,
    { $set: validated },
    { new: true }
  ).lean();
  if (!material) throw new HttpError(404, "Material not found.");
  return res.status(200).json({ success: true, data: material });
});

export const deletePcMaterial = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  assertObjectId(id);
  const material = await PackageCourseMaterial.findByIdAndDelete(id).lean();
  if (!material) throw new HttpError(404, "Material not found.");
  return res.status(200).json({ success: true, message: "Material deleted." });
});
