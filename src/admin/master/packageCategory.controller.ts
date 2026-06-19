import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCategory } from "../../models/course/PackageCategory.model";
import { createPackageCategorySchema, updatePackageCategorySchema } from "./master.validation";
import * as pkgCatSql from "../../modules/package-category/package-category.service";

export const getPackageCategories = async (req: Request, res: Response) => {
  try {
    if (pkgCatSql.isPackageCategoryMysql()) {
      return res.status(200).json({ success: true, data: await pkgCatSql.listAll() });
    }
    const categories = await PackageCategory.find().sort({ order: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createPackageCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = createPackageCategorySchema.parse(req.body);
    if (pkgCatSql.isPackageCategoryMysql()) {
      return res.status(201).json({ success: true, data: await pkgCatSql.create(validatedData as any) });
    }
    const category = new PackageCategory(validatedData);
    await category.save();
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePackageCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updatePackageCategorySchema.parse(req.body);
    if (pkgCatSql.isPackageCategoryMysql()) {
      const nid = pkgCatSql.parsePkgCatId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid Package Category ID" });
      const updated = await pkgCatSql.update(nid, validatedData as any);
      if (!updated) return res.status(404).json({ success: false, message: "Category not found" });
      return res.status(200).json({ success: true, data: updated });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Package Category ID" });
    }
    const category = await PackageCategory.findByIdAndUpdate(id, validatedData, { new: true });
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePackageCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (pkgCatSql.isPackageCategoryMysql()) {
      const nid = pkgCatSql.parsePkgCatId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid Package Category ID" });
      const ok = await pkgCatSql.remove(nid);
      if (!ok) return res.status(404).json({ success: false, message: "Category not found" });
      return res.status(200).json({ success: true, message: "Category deleted successfully" });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Package Category ID" });
    }
    const category = await PackageCategory.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.status(200).json({ success: true, message: "Category deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
