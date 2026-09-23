import { Request, Response } from "express";
import { createPackageCategorySchema, updatePackageCategorySchema } from "./master.validation";
import * as pkgCatSql from "../../modules/package-category/package-category.service";

export const getPackageCategories = async (req: Request, res: Response) => {
  try {
    const { search, sortBy, sortOrder, page, limit } = req.query as Record<string, string>;
    // Pagination is opt-in: page/limit present → paginate + return a `pagination`
    // block; otherwise the full list (back-compat for dropdown/form callers).
    const paginate = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
    const { data, total } = await pkgCatSql.listAll({
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
    return res.status(201).json({ success: true, data: await pkgCatSql.create(validatedData as any) });
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
    const nid = pkgCatSql.parsePkgCatId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid Package Category ID" });
    const updated = await pkgCatSql.update(nid, validatedData as any);
    if (!updated) return res.status(404).json({ success: false, message: "Category not found" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePackageCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = pkgCatSql.parsePkgCatId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid Package Category ID" });
    const ok = await pkgCatSql.remove(nid);
    if (!ok) return res.status(404).json({ success: false, message: "Category not found" });
    return res.status(200).json({ success: true, message: "Category deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
